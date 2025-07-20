// backend/index.js
// Entry point per il server Express del gestionale

const express = require("express");
const cors = require("cors");
const db = require("./db");
require("dotenv").config();

const app = express();
app.use(cors());
app.use(express.json());

// --- HEALTH CHECK ---
app.get("/", (_req, res) => {
  res.send(`✅ Backend gestionale attivo su porta ${process.env.PORT || 5000}`);
});

// --- SEEDING DEFAULTS ---
async function seedDefaults() {
  try {
    const types = [
      "Zanzariera",
      "Riparazione Zanzariera",
      "Veneziana",
      "Tapparella",
      "Box Doccia",
      "Tenda a Rullo",
      "Tenda da Sole"
    ];
    for (const name of types) {
      await db.query(
        `INSERT INTO product_types(name)
           SELECT $1
         WHERE NOT EXISTS (
           SELECT 1 FROM product_types WHERE name=$1
         )`,
        [name]
      );
    }

    const subMap = {
      "Zanzariera": ["Molla","Catena","Jolly","Telaio Fisso","Battente","A Kit"],
      "Riparazione Zanzariera": ["Molla","Catena"],
      "Veneziana": ["Alluminio","Legno","PVC"],
      "Tapparella": ["PVC","Alluminio","Motorizzata"],
      "Box Doccia": ["A Battente","Scorrevole"],
      "Tenda a Rullo": ["Interna","Esterna"],
      "Tenda da Sole": ["Cassonetto","A Bracci"]
    };
    for (const [typeName, subs] of Object.entries(subMap)) {
      const { rows } = await db.query(
        "SELECT id FROM product_types WHERE name=$1",
        [typeName]
      );
      if (!rows[0]) continue;
      const typeId = rows[0].id;
      for (const subName of subs) {
        await db.query(
          `INSERT INTO sub_categories(product_type_id,name)
             SELECT $1,$2
           WHERE NOT EXISTS (
             SELECT 1 FROM sub_categories
              WHERE product_type_id=$1 AND name=$2
           )`,
          [typeId, subName]
        );
      }
    }
  } catch (err) {
    console.error("Errore seeding defaults:", err);
  }
}
seedDefaults();

// --- ROUTES ---

// PRODUCT TYPES
app.get("/api/product-types", async (_req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM product_types ORDER BY name");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server product-types" });
  }
});
app.post("/api/product-types", async (req, res) => {
  const { name } = req.body;
  try {
    const { rows } = await db.query(
      "INSERT INTO product_types(name) VALUES($1) RETURNING *",
      [name]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossibile creare product-type" });
  }
});

// SUB CATEGORIES
app.get("/api/sub-categories", async (req, res) => {
  const { productTypeId } = req.query;
  try {
    const { rows } = await db.query(
      "SELECT * FROM sub_categories WHERE product_type_id=$1 ORDER BY name",
      [productTypeId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server sub-categories" });
  }
});
app.post("/api/sub-categories", async (req, res) => {
  const { productTypeId, name } = req.body;
  try {
    const { rows } = await db.query(
      "INSERT INTO sub_categories(product_type_id,name) VALUES($1,$2) RETURNING *",
      [productTypeId, name]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossibile creare sub-category" });
  }
});

// COLOR INCREMENTS
app.get("/api/color-increments", async (_req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM color_increments ORDER BY color");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server color-increments" });
  }
});
app.post("/api/color-increments", async (req, res) => {
  const { color, percentIncrement } = req.body;
  try {
    const { rows } = await db.query(
      "INSERT INTO color_increments(color,percent_increment) VALUES($1,$2) RETURNING *",
      [color, percentIncrement]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossibile creare color-increment" });
  }
});

// PRICE LISTS
app.get("/api/price-lists", async (req, res) => {
  const { customerId } = req.query;
  const clause = customerId ? "WHERE customer_id=$1" : "";
  const params = customerId ? [customerId] : [];
  try {
    const { rows } = await db.query(
      `SELECT * FROM price_lists ${clause} ORDER BY customer_id,product_type_id,sub_category_id`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server price-lists" });
  }
});
app.post("/api/price-lists", async (req, res) => {
  const { customerId, productTypeId, subCategoryId, pricePerSqm } = req.body;
  try {
    const { rows } = await db.query(
      `INSERT INTO price_lists(customer_id,product_type_id,sub_category_id,price_per_sqm)
       VALUES($1,$2,$3,$4) RETURNING *`,
      [customerId, productTypeId, subCategoryId, pricePerSqm]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossibile creare price-list" });
  }
});
app.put("/api/price-lists/:id", async (req, res) => {
  const { id } = req.params;
  const { pricePerSqm } = req.body;
  try {
    const { rows } = await db.query(
      "UPDATE price_lists SET price_per_sqm=$1 WHERE id=$2 RETURNING *",
      [pricePerSqm, id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossibile aggiornare price-list" });
  }
});
app.delete("/api/price-lists/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.query("DELETE FROM price_lists WHERE id=$1", [id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossibile cancellare price-list" });
  }
});

// WORKER AUTH
app.post("/api/worker-login", async (req, res) => {
  const { username, code } = req.body;
  try {
    const { rows } = await db.query("SELECT * FROM workers WHERE username=$1", [username]);
    const worker = rows[0];
    if (!worker) return res.status(401).json({ error: "Utente non trovato" });
    if (code !== worker.access_code) return res.status(401).json({ error: "Codice errato" });
    res.json({ id: worker.id, username: worker.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

// ORDERS CRUD
// GET all orders
app.get("/api/orders", async (_req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         o.id,
         o.customer_name,
         o.phone_number,
         o.address,
         pt.name AS product_type_name,
         sc.name AS sub_category_name,
         o.quantity,
         o.dimensions,
         o.color,
         o.custom_notes,
         o.barcode,
         o.price_total,
         o.status,
         o.created_at
       FROM orders o
       LEFT JOIN product_types pt ON o.product_type_id=pt.id
       LEFT JOIN sub_categories sc ON o.sub_category_id=sc.id
       ORDER BY o.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server orders" });
  }
});

// CREATE order
app.post("/api/orders", async (req, res) => {
  const {
    customerName,
    productTypeId,
    subCategoryId = null,
    dimensions,
    color,
    customNotes = "",
    phoneNumber = null,
    address = null
  } = req.body;

  try {
    const [w, h] = dimensions.split("x").map(Number);
    const area = (w * h) / 10000;

    const pl = await db.query(
      `SELECT price_per_sqm FROM price_lists WHERE product_type_id=$1 AND sub_category_id=$2`,
      [productTypeId, subCategoryId]
    );
    const pricePerSqm = pl.rows.length ? Number(pl.rows[0].price_per_sqm) : 0;

    const ci = await db.query(
      "SELECT percent_increment FROM color_increments WHERE color=$1",
      [color]
    );
    const percent = ci.rows[0] ? Number(ci.rows[0].percent_increment) : 0;

    const priceTotal = pricePerSqm * area * (1 + percent / 100);
    const barcode = `${Date.now()}${Math.floor(Math.random()*1000)}`;

    const { rows } = await db.query(
      `INSERT INTO orders(
         customer_name,
         product_type_id,
         sub_category_id,
         dimensions,
         color,
         custom_notes,
         phone_number,
         address,
         barcode,
         price_total
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        customerName,
        productTypeId,
        subCategoryId,
        dimensions,
        color,
        customNotes,
        phoneNumber,
        address,
        barcode,
        priceTotal
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// UPDATE status
app.patch("/api/orders/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status, workerId } = req.body;
  try {
    const { rows } = await db.query(
      `UPDATE orders SET status=$1, assigned_worker_id=COALESCE($2,assigned_worker_id) WHERE id=$3 RETURNING *`,
      [status, workerId || null, id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore aggiornamento status" });
  }
});

// GET by barcode
app.get("/api/orders/barcode/:barcode", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         o.id,
         o.customer_name,
         pt.name AS product_type_name,
         sc.name AS sub_category_name,
         o.quantity,
         o.dimensions,
         o.color,
         o.custom_notes,
         o.price_total,
         o.status,
         w.username AS assigned_worker_name
       FROM orders o
       LEFT JOIN product_types pt ON o.product_type_id=pt.id
       LEFT JOIN sub_categories sc ON o.sub_category_id=sc.id
       LEFT JOIN workers w ON o.assigned_worker_id=w.id
       WHERE o.barcode=$1`,
      [req.params.barcode]
    );
    if (!rows.length) return res.status(404).json({ error: "Ordine non trovato" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

// DELETE order
app.delete("/api/orders/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM orders WHERE id=$1", [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossibile cancellare ordine" });
  }
});

// WORKERS MANAGEMENT
app.get("/api/workers", async (_req, res) => {
  try {
    const { rows } = await db.query("SELECT id,username FROM workers ORDER BY username");
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server workers" });
  }
});
app.post("/api/workers", async (req, res) => {
  const { username, access_code } = req.body;
  try {
    const { rows } = await db.query(
      "INSERT INTO workers(username,access_code) VALUES($1,$2) RETURNING id,username,access_code",
      [username, access_code]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossibile creare worker" });
  }
});
app.delete("/api/workers/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM workers WHERE id=$1", [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossibile cancellare worker" });
  }
});

// Avvio del server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server avviato su http://localhost:${PORT}`));
