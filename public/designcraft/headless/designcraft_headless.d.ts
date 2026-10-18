/* tslint:disable */
/* eslint-disable */

export class Engine {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Register a font (TTF/OTF/TTC) for every document in this module; returns faces added.
     */
    static addFont(bytes: Uint8Array): number;
    /**
     * Run one engine command; `params` and the result are JSON text.
     */
    execute(command: string, params: string): string;
    /**
     * A session with no document; the first `file.new` / `file.openBytes` creates one.
     */
    constructor();
    /**
     * The active document's page `page` (0-based absolute index) as PNG, `scale` pixels per point.
     */
    renderPagePng(page: number, scale: number): Uint8Array;
    /**
     * Run a command script exactly as `designcraft-cli script` does and return its report:
     * `{completed, results, failedIndex?, failedCommand?, error?}`.
     */
    runScript(text: string, keep_going: boolean): string;
    /**
     * The upstream DesignCraft release this module was built from.
     */
    static version(): string;
}

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_engine_free: (a: number, b: number) => void;
    readonly engine_addFont: (a: number, b: number) => number;
    readonly engine_execute: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly engine_new: () => number;
    readonly engine_renderPagePng: (a: number, b: number, c: number) => [number, number, number, number];
    readonly engine_runScript: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly engine_version: () => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
