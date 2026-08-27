const AdmZip = require("adm-zip");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const execFileAsync = promisify(execFile);
const templatePath = path.join(__dirname, "..", "templates", "JollyFlexa-rev5.xlsm");

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function replaceCell(xml, ref, value, numeric = false) {
  const pattern = new RegExp(`<c\\b([^>]*\\br="${ref}"[^>]*)>[\\s\\S]*?<\\/c>`);
  const match = xml.match(pattern);
  if (!match) throw new Error(`Cella JOLLY ${ref} non trovata nel modello`);
  const style = (match[1].match(/\bs="([^"]+)"/) || [])[1];
  const styleAttribute = style ? ` s="${style}"` : "";
  const replacement = numeric
    ? `<c r="${ref}"${styleAttribute}><v>${Number(value)}</v></c>`
    : `<c r="${ref}"${styleAttribute} t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
  return xml.replace(pattern, replacement);
}

function replaceFormulaCache(xml, ref, value) {
  const pattern = new RegExp(`(<c\\b[^>]*\\br="${ref}"[^>]*>[\\s\\S]*?<f[^>]*>[\\s\\S]*?<\\/f>)[\\s\\S]*?(<\\/c>)`);
  if (!pattern.test(xml)) throw new Error(`Formula JOLLY ${ref} non trovata nel modello`);
  return xml.replace(pattern, `$1<v>${xmlEscape(value)}</v>$2`);
}

function getJollySheetPath(zip) {
  const workbookXml = zip.readAsText("xl/workbook.xml");
  const sheet = workbookXml.match(/<sheet\b[^>]*name="JOLLY"[^>]*r:id="([^"]+)"[^>]*\/>/);
  if (!sheet) throw new Error("Foglio JOLLY non trovato nel modello");
  const rels = zip.readAsText("xl/_rels/workbook.xml.rels");
  const relation = rels.match(new RegExp(`<Relationship\\b[^>]*Id="${sheet[1]}"[^>]*Target="([^"]+)"[^>]*/>`));
  if (!relation) throw new Error("Relazione del foglio JOLLY non trovata");
  return path.posix.join("xl", relation[1].replace(/^\//, "").replace(/^xl\//, ""));
}

async function createJollyWorkbookCopy(order, unitNumber, destination) {
  const zip = new AdmZip(templatePath);
  const sheetPath = getJollySheetPath(zip);
  let sheetXml = zip.readAsText(sheetPath);

  // Celle di input del modello originale JOLLY rev.5.
  sheetXml = replaceCell(sheetXml, "F1", order.customer_name || "");
  sheetXml = replaceCell(sheetXml, "F3", `${order.id}/${unitNumber}`);
  sheetXml = replaceCell(sheetXml, "E8", order.color || "");
  sheetXml = replaceCell(sheetXml, "E9", 1, true);
  sheetXml = replaceCell(sheetXml, "H9", Number(order.width_cm) * 10, true);
  sheetXml = replaceCell(sheetXml, "I9", Number(order.height_cm) * 10, true);
  // E43 conserva la formula =F1; si aggiorna anche il valore cache per l'export headless.
  sheetXml = replaceFormulaCache(sheetXml, "E43", order.customer_name || "");
  zip.updateFile(sheetPath, Buffer.from(sheetXml, "utf8"));

  // Forza il ricalcolo completo all'apertura senza riscrivere formule o macro.
  let workbookXml = zip.readAsText("xl/workbook.xml");
  workbookXml = workbookXml.replace(/<sheet\b([^>]*)\/>/g, (tag, attributes) => {
    const isJolly = /\bname="JOLLY"/.test(attributes);
    const withoutState = attributes.replace(/\sstate="[^"]*"/g, "");
    return isJolly
      ? `<sheet${withoutState}/>`
      : `<sheet${withoutState} state="hidden"/>`;
  });
  workbookXml = workbookXml.replace(/activeTab="\d+"/, 'activeTab="31"');
  workbookXml = workbookXml.replace(
    /<definedName\b([^>]*name="_xlnm\.Print_Area"[^>]*)>[\s\S]*?<\/definedName>/g,
    (tag, attributes) => /\blocalSheetId="31"/.test(attributes) ? tag : ""
  );
  if (/<calcPr\b/.test(workbookXml)) {
    workbookXml = workbookXml.replace(/<calcPr\b[^>]*\/?>(?:<\/calcPr>)?/, '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>');
  } else {
    workbookXml = workbookXml.replace("</workbook>", '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>');
  }
  zip.updateFile("xl/workbook.xml", Buffer.from(workbookXml, "utf8"));
  zip.writeZip(destination);
}

async function generateJollyPdf(order, unitNumber) {
  if (!(Number(order.width_cm) > 0) || !(Number(order.height_cm) > 0)) {
    throw new Error(`Ordine ${order.id}: larghezza/altezza non valide`);
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "jolly-"));
  try {
    const workbookPath = path.join(tempDir, `jolly-${order.id}-${unitNumber}.xlsm`);
    await createJollyWorkbookCopy(order, unitNumber, workbookPath);
    const officeProfile = path.join(tempDir, "office-profile");
    const soffice = process.env.LIBREOFFICE_PATH || "soffice";
    await execFileAsync(soffice, [
      "--headless",
      `-env:UserInstallation=file://${officeProfile}`,
      "--convert-to", "pdf",
      "--outdir", tempDir,
      workbookPath
    ], { timeout: 120000 });
    const pdfPath = workbookPath.replace(/\.xlsm$/i, ".pdf");
    return await fs.readFile(pdfPath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = { createJollyWorkbookCopy, generateJollyPdf };
