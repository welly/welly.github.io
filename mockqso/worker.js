// Renders QSOs off the main thread, so the page stays responsive while a long ragchew is made.
// The version stamp this worker was loaded with ("?v=…" when published), passed on to the engine and wasm.
const version = new URL(import.meta.url).search;
const ready = import(`./engine.js${version}`)
  .then(({ createEngine }) => createEngine(fetch(new URL(`mockqso.wasm${version}`, import.meta.url))));

self.onmessage = async ({ data: { id, settings, seed, date } }) => {
  try {
    const engine = await ready;
    const t = performance.now();
    const { info, samples } = engine.render(settings, BigInt(seed), new Date(date));
    info.renderMillis = performance.now() - t;
    self.postMessage({ id, info, samples }, [samples.buffer]);
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
