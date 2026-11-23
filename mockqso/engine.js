// Loads mockqso.wasm (QSOKit compiled from Swift) and renders QSOs with it.
// Works in a browser worker and in Node (for scripts/web-check.mjs).

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

  return {
    /// settings: the apps' settings object; seed: BigInt; date: when the QSO takes place.
    /// Returns { info, samples } where samples is a Float32Array copied out of Wasm memory.
    render(settings, seed, date = new Date()) {
      const json = new TextEncoder().encode(JSON.stringify(settings));
      const ptr = x.mq_input(json.length);
      new Uint8Array(memory.buffer, ptr, json.length).set(json);
      const status = x.mq_render(json.length, BigInt.asUintN(64, seed), date.getUTCHours(), date.getUTCFullYear());
      if (status !== 0) throw new Error('Mock QSO could not read the settings');
      const info = JSON.parse(new TextDecoder().decode(
        new Uint8Array(memory.buffer, x.mq_result(), x.mq_result_length())));
      const samples = new Float32Array(memory.buffer, x.mq_samples(), x.mq_sample_count()).slice();
      return { info, samples };
    },
  };
}
