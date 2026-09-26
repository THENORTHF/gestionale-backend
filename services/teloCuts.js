function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function roundHeightForZanzariera(heightMm) {
  const value = Math.round(Number(heightMm));
  if (value !== 0 && value % 200 === 0) return value;
  const base = (Math.floor(value / 200) + 1) * 200;
  return value <= base - 80 ? base : base + 200;
}

function getCutRule(productTypeName, subCategoryName) {
  const product = normalizeName(productTypeName);
  const sub = normalizeName(subCategoryName);

  if (product === "tsb") {
    if (["2b", "2 b"].includes(sub)) {
      return { mode: "normale", type: "002", note: "" };
    }
    if (["solo sotto", "solosotto"].includes(sub)) {
      return { mode: "normale", type: "001", note: "Solo sotto" };
    }
    if (["normale", "normal", "001"].includes(sub)) {
      return { mode: "normale", type: "001", note: "" };
    }
    return null;
  }

  if (product === "zanzariera") {
    if (sub === "catena") {
      return { mode: "zanzariera", type: "001", note: "Catena" };
    }
    if (sub === "molla") {
      return { mode: "zanzariera", type: "002", note: "Molla" };
    }
    if (["verticale", "verticali"].includes(sub)) {
      return { mode: "normale", type: "001", note: "Verticale" };
    }
  }
  return null;
}

function calculateCutDimensions(widthMm, heightMm, mode, type) {
  const inputWidth = Math.round(Number(widthMm));
  const inputHeight = Math.round(Number(heightMm));
  if (!(inputWidth > 0) || !(inputHeight > 0)) {
    throw new Error("Larghezza e altezza devono essere maggiori di zero");
  }

  if (mode !== "zanzariera") {
    return { cutWidthMm: inputWidth, cutHeightMm: inputHeight };
  }

  const cutWidthMm = type === "001"
    ? inputWidth - 33
    : type === "002"
      ? inputWidth - 25
      : inputWidth;
  return {
    cutWidthMm,
    cutHeightMm: roundHeightForZanzariera(inputHeight)
  };
}

function formatBarcode(widthMm, heightMm, type) {
  const width = Math.trunc(Number(widthMm));
  const height = Math.trunc(Number(heightMm));
  const normalizedType = String(type || "000").replace(/\D/g, "").padStart(3, "0").slice(-3);
  if (!(width > 0 && width <= 9999 && height > 0 && height <= 9999)) {
    throw new Error("Le misure del barcode devono essere comprese tra 1 e 9999 mm");
  }
  return `${String(width).padStart(4, "0")}${String(height).padStart(4, "0")}${normalizedType}`;
}

function prepareCutData(data) {
  const inputWidthMm = Math.round(Number(data.inputWidthMm));
  const inputHeightMm = Math.round(Number(data.inputHeightMm));
  const { cutWidthMm, cutHeightMm } = calculateCutDimensions(
    inputWidthMm,
    inputHeightMm,
    data.mode,
    data.type
  );
  const barcodeValue = formatBarcode(cutWidthMm, cutHeightMm, data.type);
  const note = [data.note, data.extraNote].filter(Boolean).join(" - ");

  return {
    inputWidthMm,
    inputHeightMm,
    cutWidthMm,
    cutHeightMm,
    barcodeValue,
    note: note || null
  };
}

async function createCutRecord(queryable, data) {
  const prepared = prepareCutData(data);

  const { rows } = await queryable.query(
    `INSERT INTO telo_cuts (
       order_id, piece_number, source_mode, processing_mode, customer_name,
       input_width_mm, input_height_mm, cut_width_mm, cut_height_mm,
       telo_type, note, barcode_value
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (order_id, piece_number) DO NOTHING
     RETURNING *;`,
    [
      data.orderId || null,
      data.pieceNumber || null,
      data.sourceMode || "manuale",
      data.mode,
      String(data.customerName || "x").trim() || "x",
      prepared.inputWidthMm,
      prepared.inputHeightMm,
      prepared.cutWidthMm,
      prepared.cutHeightMm,
      data.type,
      prepared.note,
      prepared.barcodeValue
    ]
  );
  return rows[0] || null;
}

async function createCutsForOrder(queryable, orderId) {
  const { rows } = await queryable.query(
    `SELECT o.*, pt.name AS product_type_name, sc.name AS sub_category_name
       FROM orders o
       LEFT JOIN product_types pt ON pt.id=o.product_type_id
       LEFT JOIN sub_categories sc ON sc.id=o.sub_category_id
      WHERE o.id=$1;`,
    [orderId]
  );
  const order = rows[0];
  if (!order) throw new Error("Ordine non trovato");
  const rule = getCutRule(order.product_type_name, order.sub_category_name);
  if (!rule) return [];

  const widthCm = Number(order.width_cm);
  const heightCm = Number(order.height_cm);
  if (!(widthCm > 0) || !(heightCm > 0)) {
    throw new Error(`Ordine ${order.id}: larghezza/altezza non valide`);
  }

  const created = [];
  const quantity = Math.max(1, Number(order.quantity) || 1);
  for (let piece = 1; piece <= quantity; piece += 1) {
    const cut = await createCutRecord(queryable, {
      orderId: order.id,
      pieceNumber: piece,
      sourceMode: "ordine",
      mode: rule.mode,
      type: rule.type,
      note: rule.note,
      extraNote: order.custom_notes,
      customerName: order.customer_name,
      inputWidthMm: widthCm * 10,
      inputHeightMm: heightCm * 10
    });
    if (cut) created.push(cut);
  }
  return created;
}

module.exports = {
  calculateCutDimensions,
  createCutRecord,
  createCutsForOrder,
  formatBarcode,
  getCutRule,
  prepareCutData,
  roundHeightForZanzariera
};
