#!/usr/bin/env python3
"""Recover only the original files belonging to the supplied source editions.

The metadata-only OTEManager backup identifies the articles and their attachments.
The companion ``both`` backup supplies the bytes. A local ZIP is preferred. For a
public Drive ZIP, bounded HTTP ranges avoid downloading the entire archive; this
path stops when Drive requires authentication. It never handles credentials or
changes file sharing. Reports and recovered files belong in ignored artifacts/.

Examples:
  python3 tools/designcraft/recover-drive-files.py --metadata-archive metadata.zip \
    --archive both.zip --output artifacts/source-archive-recovery
  python3 tools/designcraft/recover-drive-files.py --metadata-archive metadata.zip \
    --drive-file-id FILE_ID --archive-size SIZE --output artifacts/source-archive-recovery
  python3 tools/designcraft/recover-drive-files.py --metadata-archive metadata.zip \
    --inventory-only --output artifacts/source-archive-recovery
"""

import argparse
import hashlib
from html.parser import HTMLParser
import io
import json
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import zlib


MIB = 1024 * 1024
MAX_ENTRY_BYTES = 128 * MIB
MAX_RECOVERED_BYTES = 1024 * MIB
TARGET_EDITIONS = {(31, 3), (31, 4), (31, 5), (31, 6), (31, 7), (32, 1), (32, 2)}


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def safe_relative(value):
    if not isinstance(value, str) or not value or "\\" in value or ":" in value or "\x00" in value:
        raise ValueError("Attachment paths must be relative POSIX paths")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in value.split("/")):
        raise ValueError("Attachment paths must not traverse directories")
    return path.as_posix()


def source_records(metadata_path, editions):
    payload = metadata_path.read_bytes()
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        info = archive.getinfo("manifest.json")
        if info.file_size > 32 * MIB:
            raise ValueError("Metadata manifest is too large")
        manifest = json.loads(archive.read(info))
    data = manifest["data"]
    volumes = {volume["id"]: volume["volumeNumber"] for volume in data["volumes"]}
    issues = {issue["id"]: (volumes.get(issue["volumeId"]), issue["issueNumber"]) for issue in data["issues"]}
    selected = []
    for article in data["articles"]:
        # A linked issue is authoritative; legacy volume/issue numbers can drift.
        edition = issues.get(article.get("issueId"), (article.get("volume"), article.get("issue")))
        if edition in editions:
            selected.append(article["id"])
    selected_ids = set(selected)
    attachments = []
    for attachment in data["attachments"]:
        if attachment["articleId"] not in selected_ids:
            continue
        path = safe_relative(attachment["filePath"])
        attachments.append({
            "originalAttachmentId": attachment["id"],
            "articleId": attachment["articleId"],
            "filePath": path,
            "originalFileName": attachment.get("originalFileName"),
            "attachmentType": attachment["attachmentType"],
            "mimeType": attachment.get("mimeType"),
            "caption": attachment.get("caption"),
            "photoNumber": attachment.get("photoNumber"),
            "declaredBytes": attachment.get("fileSize"),
            "status": "missing", "localPath": None, "sha256": None,
        })
    return selected, attachments, sha256(payload)


class DrivePermissionError(RuntimeError):
    pass


class DownloadForm(HTMLParser):
    def __init__(self):
        super().__init__()
        self.action = None
        self.fields = {}

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if tag == "form":
            self.action = attrs.get("action")
        elif tag == "input" and attrs.get("name"):
            self.fields[attrs["name"]] = attrs.get("value", "")


def public_download_url(file_id):
    if not re.fullmatch(r"[A-Za-z0-9_-]{10,200}", file_id):
        raise ValueError("Invalid Drive file ID")
    url = "https://drive.google.com/uc?" + urllib.parse.urlencode({"export": "download", "id": file_id})
    with urllib.request.urlopen(url, timeout=30) as response:
        host = urllib.parse.urlsplit(response.url).hostname
        if host == "accounts.google.com":
            raise DrivePermissionError("The source backup requires Drive authentication; public range recovery is unavailable")
        if host not in ("drive.google.com", "drive.usercontent.google.com"):
            raise DrivePermissionError("Unexpected host while resolving the public source backup")
        content_type = response.headers.get("Content-Type", "")
        if not content_type.startswith("text/html"):
            return response.url
        page = response.read(MIB)
    form = DownloadForm()
    form.feed(page.decode("utf-8", "replace"))
    if (not form.action or urllib.parse.urlsplit(form.action).hostname != "drive.usercontent.google.com"
            or form.fields.get("id") != file_id):
        raise DrivePermissionError("Drive did not provide a public large-file download form")
    return form.action + "?" + urllib.parse.urlencode(form.fields)


class RangeFile(io.RawIOBase):
    """Small seekable range reader with a one-window cache for ZIP headers."""

    def __init__(self, url, size):
        self.url = url
        self.size = size
        self.position = 0
        self.window_start = 0
        self.window = b""
        self.request_count = 0
        self.downloaded_bytes = 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        if position < 0:
            raise ValueError("Cannot seek before the ZIP")
        self.position = position
        return position

    def read(self, length=-1):
        if length < 0:
            length = self.size - self.position
        length = min(length, self.size - self.position)
        if length <= 0:
            return b""
        if length > MAX_ENTRY_BYTES:
            raise ValueError("A ZIP read exceeds the bounded entry size")
        if self.window_start <= self.position and self.position + length <= self.window_start + len(self.window):
            offset = self.position - self.window_start
            result = self.window[offset:offset + length]
            self.position += length
            return result
        start = self.position
        end = min(self.size - 1, start + max(length, 65536) - 1)
        request = urllib.request.Request(self.url, headers={"Range": f"bytes={start}-{end}"})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(request, timeout=30) as response:
                    if urllib.parse.urlsplit(response.url).hostname == "accounts.google.com":
                        raise DrivePermissionError("The source ZIP requires Drive authentication")
                    expected = f"bytes {start}-{end}/{self.size}"
                    if response.status != 206 or response.headers.get("Content-Range") != expected:
                        raise RuntimeError("The server did not honor the requested bounded ZIP range")
                    data = response.read(end - start + 2)
                    if len(data) != end - start + 1:
                        raise RuntimeError("Incomplete ZIP range")
                break
            except (urllib.error.URLError, TimeoutError):
                if attempt == 2:
                    raise
                time.sleep(0.2 * (attempt + 1))
        self.request_count += 1
        self.downloaded_bytes += len(data)
        self.window_start, self.window = start, data
        self.position += length
        return data[:length]


def find_entries(archive):
    names = {}
    for info in archive.infolist():
        if info.is_dir():
            continue
        name = safe_relative(info.filename)
        if stat.S_ISLNK((info.external_attr >> 16) & 0xFFFF):
            raise ValueError("Source ZIP must not contain symlinks")
        if name in names:
            raise ValueError("Source ZIP contains duplicate names")
        names[name] = info
    return names


def matched_entry(names, path):
    direct = [name for name in (path, "files/" + path) if name in names]
    if len(direct) == 1:
        return names[direct[0]]
    if not direct:
        matches = [info for name, info in names.items() if name.endswith("/" + path)]
        if len(matches) == 1:
            return matches[0]
    return None


def recover(archive, attachments, output):
    names = find_entries(archive)
    recovered_bytes = 0
    for index, attachment in enumerate(attachments):
        info = matched_entry(names, attachment["filePath"])
        if info is None:
            attachment["reason"] = "No unique matching original file in the supplied backup"
            continue
        if info.file_size > MAX_ENTRY_BYTES or info.file_size / max(1, info.compress_size) > 1000:
            attachment["reason"] = "Original file exceeds bounded extraction limits"
            continue
        if recovered_bytes + info.file_size > MAX_RECOVERED_BYTES:
            raise ValueError("Selected attachments exceed the total extraction limit")
        original_id = attachment["originalAttachmentId"]
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", original_id):
            raise ValueError("Invalid original attachment identifier")
        suffix = PurePosixPath(attachment["filePath"]).suffix.lower()
        if not re.fullmatch(r"\.[a-z0-9]{1,10}", suffix):
            suffix = ".bin"
        # Raw artifacts use opaque filenames too, keeping anonymous author
        # names out of filenames if this directory is copied by mistake.
        target = output / "files" / original_id / ("original" + suffix)
        target.parent.mkdir(parents=True, exist_ok=True)
        content = None
        if target.exists() and target.stat().st_size == info.file_size:
            candidate = target.read_bytes()
            if zlib.crc32(candidate) & 0xFFFFFFFF == info.CRC:
                content = candidate
        if content is None:
            content = archive.read(info)  # ZipFile independently checks the CRC.
            temporary = target.with_suffix(target.suffix + ".part")
            temporary.write_bytes(content)
            temporary.replace(target)
        recovered_bytes += len(content)
        attachment.update(status="recovered", localPath=str(target.resolve()), sha256=sha256(content),
                          bytes=len(content), zipEntry=info.filename, zipCrc32=f"{info.CRC:08x}",
                          compressedBytes=info.compress_size)
        attachment.pop("reason", None)
        if (index + 1) % 25 == 0:
            print(json.dumps({"event": "recovery-progress", "checked": index + 1,
                              "recovered": sum(a["status"] == "recovered" for a in attachments)}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata-archive", required=True, type=Path)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--drive-file-id")
    parser.add_argument("--archive-size", type=int)
    parser.add_argument("--inventory-only", action="store_true")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if sum(bool(v) for v in (args.archive, args.drive_file_id, args.inventory_only)) != 1:
        parser.error("Choose --archive, --drive-file-id, or --inventory-only")
    if args.drive_file_id and (not args.archive_size or args.archive_size <= 0):
        parser.error("Public range recovery requires --archive-size")
    args.output.mkdir(parents=True, exist_ok=True)
    article_ids, attachments, metadata_sha = source_records(args.metadata_archive, TARGET_EDITIONS)
    report = {
        "schemaVersion": "ote.original-attachment-recovery.v1",
        "source": {"driveFileId": args.drive_file_id, "archiveSize": args.archive_size,
                   "metadataBackupSha256": metadata_sha, "archiveSha256": None},
        "editions": [{"volume": volume, "issue": issue} for volume, issue in sorted(TARGET_EDITIONS)],
        "articleIds": article_ids, "attachments": attachments,
        "privacy": "Private recovery inventory. No contact, payment, or financial backup tables are exported. "
                   "Original filenames and document contents can still identify authors; the public catalogue must honor anonymity preferences.",
    }
    reader = None
    try:
        if args.inventory_only:
            for attachment in attachments:
                attachment["reason"] = "Original attachment bytes have not been supplied"
            report["status"] = "inventory-only"
        else:
            if args.archive:
                report["source"]["archiveSize"] = args.archive.stat().st_size
                reader = args.archive
            else:
                reader = RangeFile(public_download_url(args.drive_file_id), args.archive_size)
            with zipfile.ZipFile(reader) as archive:
                recover(archive, attachments, args.output)
            report["status"] = "complete" if all(a["status"] == "recovered" for a in attachments) else "partial"
    except (DrivePermissionError, urllib.error.HTTPError, OSError, RuntimeError, ValueError, zipfile.BadZipFile) as error:
        report["status"] = "blocked" if isinstance(error, DrivePermissionError) else "failed"
        report["error"] = str(error)
        for attachment in attachments:
            if attachment["status"] != "recovered":
                attachment["reason"] = str(error)
    finally:
        if isinstance(reader, RangeFile):
            report["network"] = {"requests": reader.request_count, "downloadedBytes": reader.downloaded_bytes}
        report["counts"] = {
            "articles": len(article_ids), "attachments": len(attachments),
            "recovered": sum(a["status"] == "recovered" for a in attachments),
            "missing": sum(a["status"] != "recovered" for a in attachments),
            "wordDocuments": sum(a["attachmentType"] == "word_document" for a in attachments),
            "photos": sum(a["attachmentType"] == "photo" for a in attachments),
            "recoveredBytes": sum(a.get("bytes", 0) for a in attachments if a["status"] == "recovered"),
        }
        destination = args.output / "recovery-report.json"
        write_json(destination, report)
    print(json.dumps({"status": report["status"], "counts": report["counts"],
                      "report": str(destination), "error": report.get("error")}), flush=True)
    return 0 if report["status"] in ("complete", "partial", "inventory-only") else 2


if __name__ == "__main__":
    sys.exit(main())
