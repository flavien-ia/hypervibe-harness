#!/usr/bin/env node
// test-zip.mjs - Recette of the plain-Node zip writer: the archive is read
// back byte by byte, and by Python's zipfile when a Python is around.
//
//   node scripts/tests/test-zip.mjs

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { spawnSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { zipDirectory, crc32 } = await import(pathToFileURL(join(ROOT, "scripts", "_zip.mjs")).href);

let failures = 0;
let checks = 0;
function check(name, ok, detail = "") {
  checks += 1;
  if (!ok) failures += 1;
  console.log(`${ok ? "OK  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
}

check("crc32 : valeur de reference (123456789)", crc32(Buffer.from("123456789")) === 0xcbf43926);
check("crc32 : calcul par morceaux = calcul d'un bloc", crc32(Buffer.from("6789"), crc32(Buffer.from("12345"))) === 0xcbf43926);

// A small tree: a UTF-8 name, an empty file, a big incompressible file, a subfolder.
const base = mkdtempSync(join(tmpdir(), "hypervibe zip "));
const snap = join(base, "projet-snapshot");
mkdirSync(join(snap, "sub", "deeper"), { recursive: true });
const contents = {
  "a.txt": Buffer.from("hello, snapshot\n"),
  "sub/résumé.txt": Buffer.from("un résumé avec des accents : é à ç œ\n", "utf8"),
  "sub/deeper/empty.bin": Buffer.alloc(0),
  "big.bin": randomBytes(2 * 1024 * 1024),
  "text.log": Buffer.from("ligne\n".repeat(20000)),
};
for (const [rel, buf] of Object.entries(contents)) writeFileSync(join(snap, ...rel.split("/")), buf);

const zipPath = join(base, "out.zip");
const info = await zipDirectory(snap, zipPath);
check("zipDirectory : autant d'entrees que de fichiers", info.entries === 5, `${info.entries}`);

const zip = readFileSync(zipPath);
check("la taille rapportee est celle du fichier", info.bytes === zip.length);

// End of central directory, then every central entry, then every local entry.
const eocd = zip.length - 22;
check("EOCD : signature en fin d'archive (aucun commentaire)", zip.readUInt32LE(eocd) === 0x06054b50);
const count = zip.readUInt16LE(eocd + 10);
const cdSize = zip.readUInt32LE(eocd + 12);
const cdStart = zip.readUInt32LE(eocd + 16);
check("EOCD : 5 entrees, repertoire central localise", count === 5 && cdStart + cdSize === eocd);

const seen = new Map();
let pos = cdStart;
for (let i = 0; i < count; i += 1) {
  if (zip.readUInt32LE(pos) !== 0x02014b50) { check(`entree centrale ${i} : signature`, false); break; }
  const flags = zip.readUInt16LE(pos + 8);
  const method = zip.readUInt16LE(pos + 10);
  const crc = zip.readUInt32LE(pos + 16);
  const csize = zip.readUInt32LE(pos + 20);
  const usize = zip.readUInt32LE(pos + 24);
  const nameLen = zip.readUInt16LE(pos + 28);
  const extraLen = zip.readUInt16LE(pos + 30);
  const commentLen = zip.readUInt16LE(pos + 32);
  const localOffset = zip.readUInt32LE(pos + 42);
  const name = zip.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
  seen.set(name, { flags, method, crc, csize, usize, localOffset });
  pos += 46 + nameLen + extraLen + commentLen;
}
check("les noms sont relatifs au dossier parent, avec des /", [...seen.keys()].every((n) => n.startsWith("projet-snapshot/") && !n.includes("\\")), [...seen.keys()].join(", "));
check("les noms sont tries (archive deterministe)", JSON.stringify([...seen.keys()]) === JSON.stringify([...seen.keys()].sort()));
check("le drapeau UTF-8 (bit 11) est pose sur chaque entree", [...seen.values()].every((e) => (e.flags & 0x0800) !== 0));

let ok = true;
for (const [rel, buf] of Object.entries(contents)) {
  const e = seen.get(`projet-snapshot/${rel}`);
  if (!e) { ok = false; console.log(`     manque ${rel}`); continue; }
  const lo = e.localOffset;
  const sig = zip.readUInt32LE(lo);
  const nameLen = zip.readUInt16LE(lo + 26);
  const extraLen = zip.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  const data = inflateRawSync(zip.subarray(dataStart, dataStart + e.csize));
  const descriptor = zip.readUInt32LE(dataStart + e.csize);
  const good = sig === 0x04034b50 && data.equals(buf) && crc32(buf) === e.crc && e.usize === buf.length && descriptor === 0x08074b50;
  if (!good) { ok = false; console.log(`     ${rel}: sig ${sig.toString(16)} equal=${data.equals(buf)} crc=${crc32(buf) === e.crc} usize=${e.usize}/${buf.length} desc=${descriptor.toString(16)}`); }
}
check("chaque entree se decompresse a l'identique, CRC, tailles et descripteur corrects", ok);
check("le fichier incompressible n'a pas gonfle", seen.get("projet-snapshot/big.bin").csize < 2 * 1024 * 1024 + 4096);
check("le texte repetitif est compresse", seen.get("projet-snapshot/text.log").csize < 2000);

// A second, independent reader when Python is around (any of the usual names).
let crossChecked = false;
for (const py of ["python", "python3", "py"]) {
  const r = spawnSync(py, ["-c", "import sys, zipfile\nz = zipfile.ZipFile(sys.argv[1])\nbad = z.testzip()\nprint('BAD ' + bad if bad else 'OK ' + str(len(z.namelist())))", zipPath], { encoding: "utf8" });
  if (r.status === 0 && /^(OK|BAD)/.test(r.stdout.trim())) {
    check(`le zipfile de Python (${py}) relit l'archive sans erreur`, r.stdout.trim() === "OK 5", r.stdout.trim());
    crossChecked = true;
    break;
  }
}
if (!crossChecked) console.log("     (aucun Python disponible : controle croise saute, la relecture octet par octet ci-dessus fait foi)");

console.log(`\n${checks - failures}/${checks} verifications`);
if (failures) {
  console.error(`${failures} ECHEC(S)`);
  process.exit(1);
}
