#!/usr/bin/env python3
"""Reopen generated IDML with checked companion hyperlink metadata."""
import argparse
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import zipfile
from interchange_metadata import restore_metadata

spec=importlib.util.spec_from_file_location('page_compiler',Path(__file__).with_name('compile-template.py'))
compiler=importlib.util.module_from_spec(spec);spec.loader.exec_module(compiler)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--idml',type=Path,required=True);p.add_argument('--metadata',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True);p.add_argument('--cli',required=True);p.add_argument('--font-dir',type=Path)
    args=p.parse_args();out=args.output.resolve();out.mkdir(parents=True,exist_ok=True)
    (out/'review.pdf').unlink(missing_ok=True)
    fonts=args.font_dir or args.idml.resolve().parent/'Document Fonts'
    if fonts.is_dir():shutil.copytree(fonts,out/'Document Fonts',dirs_exist_ok=True)
    native=out/'document.designcraft'
    script=out/'import.dcs';script.write_text('file.open '+json.dumps({'path':str(args.idml.resolve())})+'\nfile.saveAs '+json.dumps({'path':str(native)})+'\n')
    compiler.run_script(args.cli,script,out)
    restored=restore_metadata(native,args.metadata)
    script=out/'verify.dcs';script.write_text('file.open '+json.dumps({'path':str(native)})+'\npreflight.run {}\nfile.exportPdf '+json.dumps({'path':str(out/'review.pdf'),'standard':'x4'})+'\n')
    result=compiler.run_script(args.cli,script,out)
    compiler.write_json(out/'preflight.json',result['results'][1])
    print(json.dumps({'restoredHyperlinks':restored,'preflight':result['results'][1],'adobeInDesignTested':False}))


if __name__=='__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, IndexError, subprocess.SubprocessError, zipfile.BadZipFile) as error:
        print('reopen-idml: '+str(error),file=sys.stderr)
        sys.exit(1)
