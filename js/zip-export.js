// =============================================================================
// Zip Export: Empaquetador ZIP 100% nativo, seguro y sin dependencias externas
// =============================================================================

/**
 * Tabla precalculada para CRC-32 (IEEE 802.3).
 */
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[i] = c >>> 0;
}

/**
 * Calcula el CRC-32 de un Uint8Array.
 * @param {Uint8Array} data
 * @returns {number}
 */
export function calculateCRC32(data) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * Convierte una fecha JavaScript a los formatos de fecha/hora de DOS requeridos por ZIP.
 * @param {Date} date
 * @returns {{ dosTime: number, dosDate: number }}
 */
function toDosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

/**
 * Genera un archivo ZIP que contiene múltiples archivos a partir de Blobs.
 * Utiliza compresión STORE (método 0), óptimo para PNG/JPG que ya están comprimidos,
 * garantizando compatibilidad 100% con Windows Explorer, macOS Archive Utility y Linux.
 * 
 * @param {Array<{ name: string, blob: Blob }>} files - Lista de archivos a empaquetar
 * @param {function(number, number): void} [onProgress] - Callback de progreso (actual, total)
 * @returns {Promise<Blob>}
 */
export async function createZip(files, onProgress = null) {
  const textEncoder = new TextEncoder();
  const localHeaders = [];
  const centralHeaders = [];
  let currentOffset = 0;
  const { dosTime, dosDate } = toDosDateTime(new Date());

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (onProgress) {
      onProgress(i + 1, files.length);
    }

    const arrayBuffer = await file.blob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);
    const fileNameBytes = textEncoder.encode(file.name);
    const crc = calculateCRC32(data);
    const size = data.length;

    // --- Cabecera Local del Archivo (30 bytes + nombre) ---
    const localHeader = new Uint8Array(30 + fileNameBytes.length);
    const lv = new DataView(localHeader.buffer);

    lv.setUint32(0, 0x04034b50, true);  // Firma cabecera local
    lv.setUint16(4, 20, true);          // Versión necesaria (2.0)
    lv.setUint16(6, 0x0800, true);      // Flag: Bit 11 activado (nombre UTF-8)
    lv.setUint16(8, 0, true);           // Método: 0 = STORE (sin compresión adicional)
    lv.setUint16(10, dosTime, true);    // Hora DOS
    lv.setUint16(12, dosDate, true);    // Fecha DOS
    lv.setUint32(14, crc, true);        // CRC-32
    lv.setUint32(18, size, true);       // Tamaño comprimido
    lv.setUint32(22, size, true);       // Tamaño descomprimido
    lv.setUint16(26, fileNameBytes.length, true); // Longitud nombre
    lv.setUint16(28, 0, true);          // Longitud campo extra
    localHeader.set(fileNameBytes, 30);

    // --- Cabecera del Directorio Central (46 bytes + nombre) ---
    const centralHeader = new Uint8Array(46 + fileNameBytes.length);
    const cv = new DataView(centralHeader.buffer);

    cv.setUint32(0, 0x02014b50, true);  // Firma directorio central
    cv.setUint16(4, 20, true);          // Versión creadora
    cv.setUint16(6, 20, true);          // Versión mínima requerida
    cv.setUint16(8, 0x0800, true);      // Flag UTF-8
    cv.setUint16(10, 0, true);          // Método STORE
    cv.setUint16(12, dosTime, true);    // Hora DOS
    cv.setUint16(14, dosDate, true);    // Fecha DOS
    cv.setUint32(16, crc, true);        // CRC-32
    cv.setUint32(20, size, true);       // Tamaño comprimido
    cv.setUint24 ? cv.setUint32(24, size, true) : cv.setUint32(24, size, true); // Tamaño sin comprimir
    cv.setUint16(28, fileNameBytes.length, true); // Longitud nombre
    cv.setUint16(30, 0, true);          // Campo extra
    cv.setUint16(32, 0, true);          // Comentario
    cv.setUint16(34, 0, true);          // Número de disco
    cv.setUint16(36, 0, true);          // Atributos internos
    cv.setUint32(38, 0, true);          // Atributos externos
    cv.setUint32(42, currentOffset, true); // Offset de la cabecera local
    centralHeader.set(fileNameBytes, 46);

    localHeaders.push(localHeader, data);
    centralHeaders.push(centralHeader);

    // Desplazamiento acumulado para la siguiente cabecera
    currentOffset += localHeader.length + data.length;
  }

  // --- Fin del Registro del Directorio Central (EOCD: 22 bytes) ---
  const centralDirOffset = currentOffset;
  let centralDirSize = 0;
  for (const ch of centralHeaders) {
    centralDirSize += ch.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);   // Firma EOCD
  ev.setUint16(4, 0, true);           // Número de disco
  ev.setUint16(6, 0, true);           // Disco donde inicia CD
  ev.setUint16(8, files.length, true); // Entradas en este disco
  ev.setUint16(10, files.length, true);// Total de entradas
  ev.setUint32(12, centralDirSize, true); // Tamaño del CD
  ev.setUint32(16, centralDirOffset, true); // Offset del inicio del CD
  ev.setUint16(20, 0, true);          // Comentario longitud 0

  // Ensamblar todas las partes en un único Blob binario
  const zipParts = [...localHeaders, ...centralHeaders, eocd];
  return new Blob(zipParts, { type: 'application/zip' });
}

/**
 * Dispara la descarga de un Blob en el navegador.
 * @param {Blob} blob - Archivo a descargar
 * @param {string} filename - Nombre con el que se guardará
 */
export function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
