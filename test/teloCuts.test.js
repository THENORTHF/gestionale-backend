const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateCutDimensions,
  formatBarcode,
  getCutRule,
  roundHeightForZanzariera
} = require("../services/teloCuts");

test("mappa le sottocategorie TSB", () => {
  assert.deepEqual(getCutRule("TSB", "Normale"), { mode: "normale", type: "001", note: "" });
  assert.deepEqual(getCutRule("TSB", "2B"), { mode: "normale", type: "002", note: "" });
  assert.deepEqual(getCutRule("TSB", "Solo sotto"), { mode: "normale", type: "001", note: "Solo sotto" });
});

test("mappa Catena, Molla e Verticali", () => {
  assert.deepEqual(getCutRule("Zanzariera", "Catena"), { mode: "zanzariera", type: "001", note: "Catena" });
  assert.deepEqual(getCutRule("Zanzariera", "Molla"), { mode: "zanzariera", type: "002", note: "Molla" });
  assert.deepEqual(getCutRule("Zanzariera", "Verticali"), { mode: "normale", type: "001", note: "Verticale" });
});

test("replica i calcoli della vecchia app zanzariere", () => {
  assert.equal(roundHeightForZanzariera(2302), 2400);
  assert.equal(roundHeightForZanzariera(2321), 2600);
  assert.equal(roundHeightForZanzariera(2200), 2200);
  assert.deepEqual(calculateCutDimensions(1203, 2302, "zanzariera", "001"), { cutWidthMm: 1170, cutHeightMm: 2400 });
  assert.deepEqual(calculateCutDimensions(1203, 2302, "zanzariera", "002"), { cutWidthMm: 1178, cutHeightMm: 2400 });
});

test("genera barcode compatibile larghezza+altezza+tipo", () => {
  assert.equal(formatBarcode(1170, 2400, "001"), "11702400001");
  assert.equal(formatBarcode(985, 2277, "2"), "09852277002");
});
