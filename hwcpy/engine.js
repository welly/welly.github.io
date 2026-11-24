// Loads hwcpy.wasm (PracticeKit and CWKit compiled from Swift): parses practice files and plans and renders each item.
// Works in the page and in Node (for scripts/web-check.mjs).

/// The few WASI calls the Swift runtime makes. There are no files, arguments or environment;
/// anything written to stdout/stderr goes to the console.
function wasiImports(getMemory) {
  const EBADF = 8, ENOSYS = 52;
  const decoder = new TextDecoder();
  const view = () => new DataView(getMemory().buffer);
  return {
    args_sizes_get: (argc, size) => { view().setUint32(argc, 0, true); view().setUint32(size, 0, true); return 0; },
    args_get: () => 0,
    environ_sizes_get: (count, size) => { view().setUint32(count, 0, true); view().setUint32(size, 0, true); return 0; },
    environ_get: () => 0,
    fd_write: (fd, iovs, iovsLen, written) => {
      const v = view();
      let total = 0, text = '';
      for (let i = 0; i < iovsLen; i++) {
        const ptr = v.getUint32(iovs + i * 8, true), len = v.getUint32(iovs + i * 8 + 4, true);
        text += decoder.decode(new Uint8Array(getMemory().buffer, ptr, len));
        total += len;
      }
      if (fd === 1 || fd === 2) (fd === 2 ? console.error : console.log)(text.replace(/\n$/, ''));
      v.setUint32(written, total, true);
      return 0;
    },
    fd_fdstat_get: (fd, stat) => {
      if (fd > 2) return EBADF;
      const v = view();
      v.setUint8(stat, 2); // character device
      v.setUint16(stat + 2, 0, true);
      v.setBigUint64(stat + 8, 0n, true);
      v.setBigUint64(stat + 16, 0n, true);
      return 0;
    },
    fd_prestat_get: () => EBADF, // no preopened directories
    fd_prestat_dir_name: () => EBADF,
    fd_close: () => 0,
    fd_read: () => ENOSYS,
    fd_seek: () => ENOSYS,
    path_open: () => ENOSYS,
    random_get: (ptr, len) => { crypto.getRandomValues(new Uint8Array(getMemory().buffer, ptr, len)); return 0; },
    proc_exit: (code) => { throw new Error(`Wasm exited with code ${code}`); },
  };
}

/// wasm: the module's bytes, or a fetch Response (or a promise of one), which compiles while it downloads.
export async function createEngine(wasm) {
  const wasmBytesOrResponse = await wasm;
  let memory;
  const imports = { wasi_snapshot_preview1: wasiImports(() => memory) };
  const { instance } = wasmBytesOrResponse instanceof Response
    ? await WebAssembly.instantiateStreaming(wasmBytesOrResponse, imports)
    : await WebAssembly.instantiate(wasmBytesOrResponse, imports);
  const x = instance.exports;
  memory = x.memory;
  x._initialize();

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const put = (text) => {
    const bytes = encoder.encode(text);
    const ptr = x.hw_input(bytes.length);
    new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
    return bytes.length;
  };
  const result = () => JSON.parse(decoder.decode(new Uint8Array(memory.buffer, x.hw_result(), x.hw_result_length())));

  return {
    /// Parses a practice file. Returns its items for display; plan() then works on them.
    parse(text) {
      x.hw_parse(put(text));
      return result();
    },
    /// The steps for item `index` with `settings` (the apps' PlaybackSettings keys), rendered at
    /// `sampleRate`. Returns { steps, samples }: morse and courtesy steps point into samples.
    plan(index, settings, sampleRate, singleSend = false) {
      const status = x.hw_plan(put(JSON.stringify(settings)), index, sampleRate, singleSend ? 1 : 0);
      if (status !== 0) throw new Error('HW CPY could not plan this item');
      const steps = result();
      const samples = new Float32Array(memory.buffer, x.hw_samples(), x.hw_sample_count()).slice();
      return { steps, samples };
    },
  };
}
