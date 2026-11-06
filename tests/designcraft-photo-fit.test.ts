// @vitest-environment node
import { beforeAll, describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

const root = process.cwd();
let fit: any, library: any;
const photo = (path: string, width: number, height: number) => ({ path, width, height, caption: "" });
const article = (photos: any[]) => ({ id: "a", title: "A", body: "Copy", author: "B", photos });
const sizes = (...lists: any[][]) => new Map(lists.flat().map((p) => [p.path, { width: p.width, height: p.height }]));
const template = (id: string) => library.templates.find((t: any) => t.id === id);
const slot = (t: any, role: string) => t.slots.find((s: any) => s.role === role);
const aspect = (s: any) => (s.rect[2] - s.rect[0]) / (s.rect[3] - s.rect[1]);

beforeAll(async () => {
  fit = await import(/* @vite-ignore */ pathToFileURL(join(root, "public/designcraft/compiler/photo-fit.js")).href);
  library = JSON.parse(await readFile(join(root, "public/designcraft/templates.json"), "utf8"));
});

describe("imageSize", () => {
  test("reads PNG and JPEG sizes from the header", async () => {
    const raw = { create: { width: 40, height: 30, channels: 3 as const, background: "#888" } };
    expect(fit.imageSize(new Uint8Array(await sharp(raw).png().toBuffer()))).toEqual({ width: 40, height: 30 });
    expect(fit.imageSize(new Uint8Array(await sharp(raw).jpeg().toBuffer()))).toEqual({ width: 40, height: 30 });
  });
  test("applies EXIF rotation, because phone portraits are stored sideways", async () => {
    const raw = { create: { width: 40, height: 30, channels: 3 as const, background: "#888" } };
    const rotated = await sharp(raw).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    expect(fit.imageSize(new Uint8Array(rotated))).toEqual({ width: 30, height: 40 });
  });
  test("refuses bytes that are not an image it can read", () => {
    expect(fit.imageSize(new Uint8Array([1, 2, 3, 4, 5]))).toBeNull();
    expect(fit.imageSize(new Uint8Array(0))).toBeNull();
  });
});

describe("assignPhotos", () => {
  test("gives a wide slot the wide photo even when it was uploaded second", () => {
    const photos = [photo("tall", 800, 1600), photo("wide", 1600, 900)];
    const assigned = fit.assignPhotos(template("story-1-top-small-balanced"), [article(photos)], sizes(photos));
    expect(slot(assigned, "photo").photoIndex).toBe(1);
    expect(slot(assigned, "caption").photoIndex).toBe(1);
  });
  test("does not change the shared template", () => {
    const base = template("story-1-top-small-balanced");
    fit.assignPhotos(base, [article([photo("p", 100, 100)])], new Map());
    expect(slot(base, "photo").photoIndex).toBeUndefined();
  });
});

describe("fitPhotoFrames", () => {
  test("a landscape photo gets its exact shape over the columns and the body gives way", () => {
    const photos = [photo("p", 2400, 1000)], order = [article(photos)];
    const base = fit.assignPhotos(template("story-1-top-small-balanced"), order, sizes(photos));
    const { template: shaped } = fit.fitPhotoFrames(base, order, sizes(photos));
    expect(aspect(slot(shaped, "photo"))).toBeCloseTo(2.4, 1);
    expect(slot(shaped, "body").rect[3]).toBe(slot(base, "body").rect[3]);
    expect(slot(shaped, "body").rect[1]).toBeGreaterThan(slot(shaped, "photo").rect[3]);
    expect(shaped.id).toContain("@photo-shaped");
  });
  test("a very tall photo is capped rather than taking over the page", () => {
    const photos = [photo("p", 500, 2000)], order = [article(photos)];
    const base = fit.assignPhotos(template("story-1-top-small-balanced"), order, sizes(photos));
    const height = (s: any) => s.rect[3] - s.rect[1];
    expect(height(slot(fit.fitPhotoFrames(base, order, sizes(photos)).template, "photo"))).toBeLessThanOrEqual(0.52 * 644 + 0.01);
  });
  test("a portrait side photo keeps its shape and the body widens", () => {
    const base = template("story-1-left-balanced"), height = slot(base, "photo").rect[3] - slot(base, "photo").rect[1];
    const photos = [photo("p", 550, 1000)], order = [article(photos)];
    const { template: shaped } = fit.fitPhotoFrames(fit.assignPhotos(base, order, sizes(photos)), order, sizes(photos));
    expect(aspect(slot(shaped, "photo"))).toBeCloseTo(0.55, 2);
    expect(slot(shaped, "photo").rect[3] - slot(shaped, "photo").rect[1]).toBeCloseTo(height, 1);
    expect(slot(shaped, "body").rect[0]).toBeLessThan(slot(base, "body").rect[0]);
  });
  test("two photos in a row share one height and both keep their shape", () => {
    const base = library.templates.find((t: any) => t.kind === "story" && !t.design && t.storyCount === 1 && t.pattern === "two-top");
    if (!base) return;
    const photos = [photo("a", 1200, 800), photo("b", 900, 1200)], order = [article(photos)];
    const { template: shaped } = fit.fitPhotoFrames(fit.assignPhotos(base, order, sizes(photos)), order, sizes(photos));
    const [first, second] = shaped.slots.filter((s: any) => s.role === "photo");
    expect(first.rect[3] - first.rect[1]).toBeCloseTo(second.rect[3] - second.rect[1], 1);
    expect(first.rect[2]).toBeLessThan(second.rect[0]);
  });
});

describe("insetPhotos", () => {
  test("a portrait drops into the columns at its exact shape, with a matching wrap", () => {
    const photos = [photo("p", 3000, 4000)], order = [article(photos)];
    const result = fit.insetPhotos(fit.assignPhotos(template("story-1-top-small-balanced"), order, sizes(photos)), order, sizes(photos));
    const shaped = result.template, frame = slot(shaped, "photo"), wrap = slot(shaped, "wrap"), body = slot(shaped, "body");
    expect(aspect(frame)).toBeCloseTo(0.75, 1);
    expect(frame.rect[2]).toBeCloseTo(body.rect[2], 1);
    expect(frame.rect[1]).toBeCloseTo(body.rect[1], 1);
    expect(wrap.rect[3]).toBeGreaterThanOrEqual(frame.rect[3]);
    expect(wrap.points).toHaveLength(4);
    expect(body.columns).toBe(3);
  });
  test("prefers a smaller span when a larger one would print soft", () => {
    const photos = [photo("p", 300, 400)], order = [article(photos)];
    const base = fit.assignPhotos(template("story-1-top-small-balanced"), order, sizes(photos));
    const [report] = fit.photoReport(fit.insetPhotos(base, order, sizes(photos)).template, order, sizes(photos));
    expect(report.crop).toBeLessThan(0.02);
    const large = photos.map((p) => ({ ...p, width: 3000, height: 4000 }));
    const wide = fit.insetPhotos(fit.assignPhotos(template("story-1-top-small-balanced"), [article(large)], sizes(large)), [article(large)], sizes(large)).template;
    expect(slot(fit.insetPhotos(base, order, sizes(photos)).template, "photo").rect[2] - slot(fit.insetPhotos(base, order, sizes(photos)).template, "photo").rect[0])
      .toBeLessThanOrEqual(slot(wide, "photo").rect[2] - slot(wide, "photo").rect[0]);
  });
});

test("photoReport states crop and print resolution in plain terms", () => {
  const photos = [photo("p", 1200, 1200)], order = [article(photos)];
  const [report] = fit.photoReport(fit.assignPhotos(template("story-1-top-small-balanced"), order, sizes(photos)), order, sizes(photos));
  expect(report.shape).toBe("square");
  expect(report.crop).toBeGreaterThan(0.5);
  expect(report.ppi).toBeGreaterThan(0);
});

test("photoLayouts always keeps the as-designed reading alongside the reshaped ones", () => {
  const photos = [photo("p", 3000, 4000)], order = [article(photos)];
  const modes = fit.photoLayouts(template("story-1-top-small-balanced"), order, sizes(photos)).map((l: any) => l.mode);
  expect(modes[0]).toBe("as-designed");
  expect(modes).toContain("shaped");
  expect(modes).toContain("inset-right");
  expect(modes).toContain("inset-left");
});

describe("layout safety", () => {
  const stories = () => library.templates.filter((t: any) => t.kind === "story" && !t.source);
  const shapes = [[3000, 4000], [4000, 3000], [2000, 2000], [800, 2000], [3000, 1000]];
  test("no photo-led layout of any story template puts content on top of content", () => {
    let checked = 0;
    for (const base of stories()) for (const [width, height] of shapes) {
      const order = Array.from({ length: base.storyCount }, (_, i) => article(Array.from({ length: 3 }, (_, n) => photo(`p${i}-${n}`, width, height))));
      const map = sizes(...order.map((a) => a.photos));
      const known = new Set(fit.layoutCollisions(fit.assignPhotos(base, order, map)).map(String));
      for (const layout of fit.photoLayouts(base, order, map)) {
        checked++;
        expect(fit.layoutCollisions(layout.template).filter((hit: any) => !known.has(String(hit))), layout.template.id).toEqual([]);
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
  test("a body drawn over a headline is caught, and an inset inside its wrap is not", () => {
    const body = { id: "b", role: "body", rect: [0, 0, 300, 300] };
    expect(fit.layoutCollisions({ slots: [body, { id: "h", role: "headline", rect: [10, 10, 200, 40] }] })).toEqual([["b", "h"]]);
    const inset = { id: "p", role: "photo", rect: [150, 0, 300, 150] };
    expect(fit.layoutCollisions({ slots: [body, inset] })).toEqual([["b", "p"]]);
    expect(fit.layoutCollisions({ slots: [body, inset, { id: "w", role: "wrap", rect: [150, 0, 300, 170] }] })).toEqual([]);
  });
  test("templates with the photo above the headline are not inset over that headline", () => {
    const base = library.templates.find((t: any) => t.pattern === "shared-top" && t.storyCount === 2 && !t.design);
    const order = [article([photo("a", 1080, 720)]), article([photo("b", 1080, 720)])];
    const modes = fit.photoLayouts(base, order, sizes(order[0].photos, order[1].photos)).map((l: any) => l.mode);
    expect(modes.filter((m: string) => m.startsWith("inset"))).toEqual([]);
  });
});
