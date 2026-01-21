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

// --- SCHEMA ENSURE ---
async function ensureSchema() {
  await db.query(`
    -- CUSTOMERS (anagrafica clienti)
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      phone_number TEXT,
      address TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_customers_name_lower
      ON customers (LOWER(name));

    CREATE TABLE IF NOT EXISTS product_types (
      id SERIAL PRIMARY KEY,
      name TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sub_categories (
      id SERIAL PRIMARY KEY,
      product_type_id INTEGER REFERENCES product_types(id),
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS color_increments (
      id SERIAL PRIMARY KEY,
      color TEXT UNIQUE NOT NULL,
      percent_increment NUMERIC NOT NULL
    );
    CREATE TABLE IF NOT EXISTS price_lists (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER,
      product_type_id INTEGER REFERENCES product_types(id),
      sub_category_id INTEGER REFERENCES sub_categories(id),
      price_per_sqm NUMERIC NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workers (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      access_code TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      customer_id INTEGER REFERENCES customers(id),
      customer_name TEXT NOT NULL,
      product_type_id INTEGER REFERENCES product_types(id),
      sub_category_id INTEGER REFERENCES sub_categories(id),
      quantity INTEGER DEFAULT 1,
      dimensions TEXT NOT NULL,
      color TEXT NOT NULL,
      custom_notes TEXT,
      phone_number TEXT,
      address TEXT,
      barcode TEXT UNIQUE NOT NULL,
      price_total NUMERIC NOT NULL,       -- prezzo calcolato (base)
      status TEXT DEFAULT 'In attesa',
      assigned_worker_id INTEGER REFERENCES workers(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS work_statuses (
      id SERIAL PRIMARY KEY,
      product_type_id INTEGER NOT NULL REFERENCES product_types(id),
      sub_category_id INTEGER REFERENCES sub_categories(id),
      status_list TEXT NOT NULL,
      UNIQUE (product_type_id, sub_category_id)
    );

    -- Vincolo UNIQUE corretto sulle sub-categorie
    ALTER TABLE sub_categories
      DROP CONSTRAINT IF EXISTS sub_categories_name_key;
    DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'sub_categories_product_type_name_key'
        ) THEN
          ALTER TABLE sub_categories
          ADD CONSTRAINT sub_categories_product_type_name_key
          UNIQUE (product_type_id, name);
        END IF;
      END
    $$;

    -- ✅ NUOVO CAMPO: prezzo manuale opzionale
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS manual_price NUMERIC NULL;

    -- ✅ CUSTOMER_ID opzionale sugli ordini (compatibilità con vecchi dati)
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS customer_id INTEGER NULL;
  `);
}


// --- SEEDING DEFAULTS ---
async function seedDefaults() {
  try {
    // Seed product_types
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
         );`,
        [name]
      );
    }

    // Seed sub_categories
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
        "SELECT id FROM product_types WHERE name=$1;",
        [typeName]
      );
      if (!rows[0]) continue;
      const typeId = rows[0].id;
      for (const subName of subs) {
        await db.query(
          `INSERT INTO sub_categories(product_type_id, name)
             SELECT $1, $2
           WHERE NOT EXISTS (
             SELECT 1 FROM sub_categories
             WHERE product_type_id=$1 AND name=$2
           );`,
          [typeId, subName]
        );
      }
    }

    // Seed worker di default
    await db.query(
      `INSERT INTO workers(username, access_code)
         SELECT 'admin', 'admin123'
       WHERE NOT EXISTS (
         SELECT 1 FROM workers WHERE username='admin'
       );`
    );

    // Seed color_increments demo
    const colorSeeds = [
      { color: 'Bianco', percent: 0 },
      { color: 'Nero', percent: 5 },
      { color: 'Rosso', percent: 10 }
    ];
    for (const { color, percent } of colorSeeds) {
      await db.query(
        `INSERT INTO color_increments(color, percent_increment)
           SELECT $1, $2
         WHERE NOT EXISTS (
           SELECT 1 FROM color_increments WHERE color=$1
         );`,
        [color, percent]
      );
    }

    // Seed price_lists demo: per customer_id=1, Zanzariera/Molla
    const pl = await db.query(
      `SELECT pt.id AS pt_id, sc.id AS sc_id
         FROM product_types pt
         JOIN sub_categories sc ON sc.product_type_id=pt.id
         WHERE pt.name='Zanzariera' AND sc.name='Molla' LIMIT 1;`
    );
    if (pl.rows[0]) {
      const { pt_id, sc_id } = pl.rows[0];
      await db.query(
        `INSERT INTO price_lists(customer_id, product_type_id, sub_category_id, price_per_sqm)
           SELECT 1, $1, $2, 25.0
         WHERE NOT EXISTS (
           SELECT 1 FROM price_lists
           WHERE customer_id=1 AND product_type_id=$1 AND sub_category_id=$2
         );`,
        [pt_id, sc_id]
      );
    }

  } catch (err) {
    console.error("Errore seeding defaults:", err);
  }
}

// --- START SERVER ---
async function startServer() {
  try {
    await ensureSchema();
  } catch (err) {
    console.error("Errore in ensureSchema (ignoro e continuo):", err);
  }
  try {
    await seedDefaults();
  } catch (err) {
    console.error("Errore in seedDefaults (ignoro e continuo):", err);
  }
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, '0.0.0.0', () =>
    console.log(`Server attivo su http://0.0.0.0:${PORT}`)
  );
}
startServer();

// --- ROUTES ---

// PRODUCT TYPES
app.get("/api/product-types", async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT * FROM product_types ORDER BY name;"
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server product-types" });
  }
});
app.post("/api/product-types", async (req, res) => {
  try {
    const { name } = req.body;
    const { rows } = await db.query(
      "INSERT INTO product_types(name) VALUES($1) RETURNING *;",
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
  try {
    const { productTypeId } = req.query;
    const { rows } = await db.query(
      "SELECT * FROM sub_categories WHERE product_type_id=$1 ORDER BY name;",
      [productTypeId]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server sub-categories" });
  }
});
app.post("/api/sub-categories", async (req, res) => {
  try {
    const { productTypeId, name } = req.body;
    const { rows } = await db.query(
      "INSERT INTO sub_categories(product_type_id,name) VALUES($1,$2) RETURNING *;",
      [productTypeId, name]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossibile creare sub-category" });
  }
});

// COLOR INCREMENTS
app.get("/api/color-increments", async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT * FROM color_increments ORDER BY color;"
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server color-increments" });
  }
});
app.post("/api/color-increments", async (req, res) => {
  try {
    const { color, percentIncrement } = req.body;
    const { rows } = await db.query(
      "INSERT INTO color_increments(color,percent_increment) VALUES($1,$2) RETURNING *;",
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
  try {
    const { customerId } = req.query;
    const clause = customerId ? "WHERE customer_id=$1" : "";
    const params = customerId ? [customerId] : [];
    const { rows } = await db.query(
      `SELECT * FROM price_lists ${clause} ORDER BY customer_id,product_type_id,sub_category_id;`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server price-lists" });
  }
});
app.post("/api/price-lists", async (req, res) => {
  try {
    const { customerId, productTypeId, subCategoryId, pricePerSqm } = req.body;
    const { rows } = await db.query(
      `INSERT INTO price_lists(customer_id,product_type_id,sub_category_id,price_per_sqm)
       VALUES($1,$2,$3,$4) RETURNING *;`,
      [customerId, productTypeId, subCategoryId, pricePerSqm]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossibile creare price-list" });
  }
});
app.put("/api/price-lists/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { pricePerSqm } = req.body;
    const { rows } = await db.query(
      "UPDATE price_lists SET price_per_sqm=$1 WHERE id=$2 RETURNING *;",
      [pricePerSqm, id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossibile aggiornare price-list" });
  }
});
app.delete("/api/price-lists/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM price_lists WHERE id=$1;", [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossibile cancellare price-list" });
  }
});

// WORKER AUTH
app.post("/api/worker-login", async (req, res) => {
  try {
    const { username, access_code } = req.body;
    const { rows } = await db.query(
      "SELECT * FROM workers WHERE username=$1;",
      [username]
    );
    const worker = rows[0];
    if (!worker) return res.status(401).json({ error: "Utente non trovato" });
    if (access_code !== worker.access_code)
      return res.status(401).json({ error: "Codice errato" });
    res.json({ id: worker.id, username: worker.username });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server" });
  }
});

// --- CUSTOMERS (ANAGRAFICA CLIENTI) ---

// Suggerimenti per autocomplete (starts-with)
app.get("/api/customers/suggest", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    const limit = Math.min(parseInt(req.query.limit || "10", 10) || 10, 50);
    if (!q) return res.json([]);

    const { rows } = await db.query(
      `SELECT id, name, phone_number, address
       FROM customers
       WHERE LOWER(name) LIKE LOWER($1)
       ORDER BY name ASC
       LIMIT $2;`,
      [`${q}%`, limit]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server customers suggest" });
  }
});

// Lista clienti (con ricerca semplice)
app.get("/api/customers", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const params = [];
    const where = search ? "WHERE LOWER(name) LIKE LOWER($1)" : "";
    if (search) params.push(`%${search}%`);

    const { rows } = await db.query(
      `SELECT id, name, phone_number, address, created_at
       FROM customers
       ${where}
       ORDER BY name ASC;`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server customers" });
  }
});

// Crea cliente
app.post("/api/customers", async (req, res) => {
  try {
    const { name, phone_number = null, address = null } = req.body || {};
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "name richiesto" });
    }

    const { rows } = await db.query(
      `INSERT INTO customers (name, phone_number, address)
       VALUES ($1,$2,$3)
       RETURNING id, name, phone_number, address, created_at;`,
      [String(name).trim(), phone_number || null, address || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    // Gestione nome duplicato
    if (String(err.code) === "23505") {
      return res.status(409).json({ error: "Cliente già esistente" });
    }
    res.status(500).json({ error: "Impossibile creare cliente" });
  }
});

// Aggiorna cliente
app.put("/api/customers/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, phone_number = null, address = null } = req.body || {};
    if (!id) return res.status(400).json({ error: "id non valido" });
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: "name richiesto" });
    }
    const { rows } = await db.query(
      `UPDATE customers
         SET name=$1,
             phone_number=$2,
             address=$3
       WHERE id=$4
       RETURNING id, name, phone_number, address, created_at;`,
      [String(name).trim(), phone_number || null, address || null, id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Cliente non trovato" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    if (String(err.code) === "23505") {
      return res.status(409).json({ error: "Nome cliente già in uso" });
    }
    res.status(500).json({ error: "Impossibile aggiornare cliente" });
  }
});

// Elimina cliente
app.delete("/api/customers/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: "id non valido" });
    await db.query("DELETE FROM customers WHERE id=$1;", [id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossibile cancellare cliente" });
  }
});

// ORDERS CRUD
app.get("/api/orders", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         o.id,
         o.customer_name,
         o.phone_number,
         o.address,
         o.product_type_id,
         o.sub_category_id,
         pt.name AS product_type_name,
         sc.name AS sub_category_name,
         o.quantity,
         o.dimensions,
         o.color,
         o.custom_notes,
         o.barcode,
         o.price_total,
         o.manual_price,
         COALESCE(o.manual_price, o.price_total) AS effective_price,
         o.status,
         o.created_at
       FROM orders o
       LEFT JOIN product_types pt ON o.product_type_id=pt.id
       LEFT JOIN sub_categories sc ON o.sub_category_id=sc.id
       ORDER BY o.created_at DESC;`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server orders" });
  }
});

app.post("/api/orders", async (req, res) => {
  try {
    const {
      customerId = null,
      customerName,
      productTypeId,
      subCategoryId = null,
      quantity = 1,
      dimensions,
      color,
      customNotes = "",
      phoneNumber = null,
      address = null,
      manualPrice = null   // ✅ opzionale (usato se presente)
    } = req.body;

    const [w, h] = dimensions.split("x").map(Number);
    const area = (w * h) / 10000;

    const pl = await db.query(
      "SELECT price_per_sqm FROM price_lists WHERE product_type_id=$1 AND sub_category_id=$2;",
      [productTypeId, subCategoryId]
    );
    const pricePerSqm = pl.rows.length ? Number(pl.rows[0].price_per_sqm) : 0;

    const ci = await db.query(
      "SELECT percent_increment FROM color_increments WHERE color=$1;",
      [color]
    );
    const percent = ci.rows[0] ? Number(ci.rows[0].percent_increment) : 0;

    const priceTotal = pricePerSqm * area * (1 + percent / 100);
    const barcode = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

    const { rows } = await db.query(
      `INSERT INTO orders(
         customer_id,
         customer_name,
         product_type_id,
         sub_category_id,
         quantity,
         dimensions,
         color,
         custom_notes,
         phone_number,
         address,
         barcode,
         price_total,
         manual_price
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *;`,
      [
        customerId,
        customerName,
        productTypeId,
        subCategoryId,
        quantity,
        dimensions,
        color,
        customNotes,
        phoneNumber,
        address,
        barcode,
        priceTotal,
        manualPrice // può essere null
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/orders/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, workerId } = req.body;
    const { rows } = await db.query(
      `UPDATE orders
         SET status=$1,
             assigned_worker_id=COALESCE($2,assigned_worker_id)
       WHERE id=$3 RETURNING *;`,
      [status, workerId || null, id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore aggiornamento status" });
  }
});

// ✅ Nuova rotta: aggiorna il prezzo manuale (solo admin lato FE; qui non c'è auth middleware)
app.patch("/api/orders/:id/price", async (req, res) => {
  try {
    const { id } = req.params;
    let { manualPrice } = req.body;
    if (manualPrice === "" || manualPrice === undefined) manualPrice = null;

    const { rows } = await db.query(
      "UPDATE orders SET manual_price=$1 WHERE id=$2 RETURNING *;",
      [manualPrice, id]
    );
    if (!rows[0]) return res.status(404).json({ error: "Ordine non trovato" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore aggiornamento prezzo manuale" });
  }
});

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
         o.manual_price,
         COALESCE(o.manual_price, o.price_total) AS effective_price,
         o.status,
         o.product_type_id,
         o.sub_category_id,
         w.username AS assigned_worker_name
       FROM orders o
       LEFT JOIN product_types pt ON o.product_type_id=pt.id
       LEFT JOIN sub_categories sc ON o.sub_category_id=sc.id
       LEFT JOIN workers w ON o.assigned_worker_id=w.id
       WHERE o.barcode=$1;`,
      [req.params.barcode]
    );
    if (!rows.length) return res.status(404).json({ error: "Ordine non trovato" });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server ordine by barcode" });
  }
});

app.delete("/api/orders/:id", async (req, res) => {
  try {
    await db.query("DELETE FROM orders WHERE id=$1;", [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossibile cancellare ordine" });
  }
});

// --- WORK STATUSES (STATI DI LAVORAZIONE PERSONALIZZATI) ---

// 1. GET: Stati di lavorazione per un prodotto+sottocategoria
app.get("/api/work-statuses", async (req, res) => {
  const { productTypeId, subCategoryId } = req.query;
  if (!productTypeId) return res.status(400).json({ error: "productTypeId richiesto" });
  try {
    const { rows } = await db.query(
      `SELECT * FROM work_statuses
       WHERE product_type_id=$1 AND
             (sub_category_id = $2 OR $2 IS NULL)
       LIMIT 1;`,
      [productTypeId, subCategoryId || null]
    );
    if (!rows[0]) {
      // Default: nessuno stato ancora creato
      return res.json({ status_list: '["In attesa","In lavorazione 1","In lavorazione 2","Pronto","Consegnato"]' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore recupero stati lavorazione" });
  }
});

// 2. POST: Crea o aggiorna stati di lavorazione per un prodotto+sottocategoria
app.post("/api/work-statuses", async (req, res) => {
  const { productTypeId, subCategoryId, statusList } = req.body;
  if (!productTypeId || !statusList) return res.status(400).json({ error: "Dati mancanti" });
  try {
    // Upsert: se esiste, aggiorna; altrimenti inserisci
    const { rows } = await db.query(
      `INSERT INTO work_statuses (product_type_id, sub_category_id, status_list)
        VALUES ($1, $2, $3)
        ON CONFLICT (product_type_id, sub_category_id)
        DO UPDATE SET status_list = EXCLUDED.status_list
        RETURNING *;`,
      [productTypeId, subCategoryId || null, JSON.stringify(statusList)]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossibile salvare stati lavorazione" });
  }
});

// 3. (Opzionale) GET: tutti gli stati di lavorazione configurati
app.get("/api/work-statuses/all", async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM work_statuses;`);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore recupero tutte le configurazioni stati lavorazione" });
  }
});


// WORKERS MANAGEMENT
app.get("/api/workers", async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id,username FROM workers ORDER BY username;"
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Errore server workers" });
  }
});
app.post("/api/workers", async (req, res) => {
  try {
    const { username, access_code } = req.body;
    const { rows } = await db.query(
      "INSERT INTO workers(username,access_code) VALUES($1,$2) RETURNING id,username;",
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
    await db.query("DELETE FROM workers WHERE id=$1;", [req.params.id]);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Impossibile cancellare worker" });
  }
});
