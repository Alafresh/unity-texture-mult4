// =============================================================================
// Image Processor: Lógica matemática, cálculo de padding y manipulación Canvas
// =============================================================================

/**
 * Redondea un entero hacia arriba al múltiplo de 4 más cercano.
 * @param {number} n - Dimensión original en píxeles.
 * @returns {number} - Dimensión múltiplo de 4 (mínimo el valor de entrada).
 */
export function roundUpToMultipleOf4(n) {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n / 4) * 4;
}

/**
 * Valida si una dimensión es múltiplo de 4.
 * @param {number} n
 * @returns {boolean}
 */
export function isMultipleOf4(n) {
  return Number.isInteger(n) && n > 0 && n % 4 === 0;
}

/**
 * Calcula el desplazamiento y tamaño de padding según el ancla elegida.
 * En canvas 2D, (0,0) es la esquina superior-izquierda.
 * 
 * En Unity Sprite Editor, el origen (0,0) es inferior-izquierda.
 * Por lo tanto, el ancla 'bottom-left' en Unity equivale a colocar la imagen
 * en la parte inferior-izquierda del nuevo lienzo:
 * - El padding horizontal se añade a la DERECHA (x = 0).
 * - El padding vertical se añade ARRIBA (y = deltaH).
 * De este modo, las coordenadas de los sprites existentes medidos desde abajo
 * a la izquierda se mantienen idénticas.
 * 
 * @param {number} width - Ancho original
 * @param {number} height - Alto original
 * @param {string} anchor - 'bottom-left' (default), 'center', 'top-left'
 * @returns {object} { targetWidth, targetHeight, deltaW, deltaH, offsetX, offsetY, padLeft, padTop, padRight, padBottom }
 */
export function calculatePadding(width, height, anchor = 'bottom-left') {
  const targetWidth = roundUpToMultipleOf4(width);
  const targetHeight = roundUpToMultipleOf4(height);
  const deltaW = targetWidth - width;
  const deltaH = targetHeight - height;

  let offsetX = 0;
  let offsetY = 0;
  let padLeft = 0;
  let padRight = 0;
  let padTop = 0;
  let padBottom = 0;

  switch (anchor) {
    case 'center':
      // Reparto de píxeles impares: floor a un lado, ceil al otro
      padLeft = Math.floor(deltaW / 2);
      padRight = Math.ceil(deltaW / 2);
      padTop = Math.floor(deltaH / 2);
      padBottom = Math.ceil(deltaH / 2);
      offsetX = padLeft;
      offsetY = padTop;
      break;

    case 'top-left':
      // Padding abajo y a la derecha
      padLeft = 0;
      padRight = deltaW;
      padTop = 0;
      padBottom = deltaH;
      offsetX = 0;
      offsetY = 0;
      break;

    case 'bottom-left':
    default:
      // Unity default: Origen abajo-izquierda.
      // En canvas: imagen pegada abajo (y = deltaH) y a la izquierda (x = 0).
      // Padding resultante: Arriba (+deltaH) y Derecha (+deltaW).
      padLeft = 0;
      padRight = deltaW;
      padTop = deltaH;
      padBottom = 0;
      offsetX = 0;
      offsetY = deltaH;
      break;
  }

  return {
    targetWidth,
    targetHeight,
    deltaW,
    deltaH,
    offsetX,
    offsetY,
    padLeft,
    padRight,
    padTop,
    padBottom,
    isAlreadyMultiple: deltaW === 0 && deltaH === 0
  };
}

/**
 * Carga un archivo File en un elemento Image para inspeccionar dimensiones.
 * @param {File} file
 * @returns {Promise<HTMLImageElement>}
 */
export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`No se pudo leer la imagen "${file.name}". Puede estar corrupta o tener un formato no soportado.`));
    };

    img.src = url;
  });
}

/**
 * Aplica replicación de bordes (clamp-to-edge) a los píxeles de padding.
 * Se copian las filas/columnas extremas hacia los 1 a 3 píxeles de margen
 * para evitar franjas que contaminen el filtrado bilineal en texturas opacas.
 * 
 * @param {CanvasRenderingContext2D} ctx
 * @param {HTMLImageElement|ImageBitmap} img
 * @param {number} x - Posición X de la imagen original en el canvas
 * @param {number} y - Posición Y de la imagen original en el canvas
 * @param {number} w - Ancho original
 * @param {number} h - Alto original
 * @param {object} pad - Objeto con padLeft, padRight, padTop, padBottom
 */
function applyEdgeClamping(ctx, img, x, y, w, h, pad) {
  ctx.imageSmoothingEnabled = false;

  // 1. Replicar borde superior (fila superior de 1px estirada hacia arriba)
  if (pad.padTop > 0) {
    ctx.drawImage(img, 0, 0, w, 1, x, y - pad.padTop, w, pad.padTop);
  }

  // 2. Replicar borde inferior (fila inferior de 1px estirada hacia abajo)
  if (pad.padBottom > 0) {
    ctx.drawImage(img, 0, h - 1, w, 1, x, y + h, w, pad.padBottom);
  }

  // 3. Replicar borde izquierdo (columna izquierda de 1px estirada hacia la izquierda)
  if (pad.padLeft > 0) {
    ctx.drawImage(img, 0, 0, 1, h, x - pad.padLeft, y, pad.padLeft, h);
  }

  // 4. Replicar borde derecho (columna derecha de 1px estirada hacia la derecha)
  if (pad.padRight > 0) {
    ctx.drawImage(img, w - 1, 0, 1, h, x + w, y, pad.padRight, h);
  }

  // 5. Replicar las 4 esquinas si hay padding simultáneo horizontal y vertical
  if (pad.padTop > 0 && pad.padLeft > 0) {
    ctx.drawImage(img, 0, 0, 1, 1, x - pad.padLeft, y - pad.padTop, pad.padLeft, pad.padTop);
  }
  if (pad.padTop > 0 && pad.padRight > 0) {
    ctx.drawImage(img, w - 1, 0, 1, 1, x + w, y - pad.padTop, pad.padRight, pad.padTop);
  }
  if (pad.padBottom > 0 && pad.padLeft > 0) {
    ctx.drawImage(img, 0, h - 1, 1, 1, x - pad.padLeft, y + h, pad.padLeft, pad.padBottom);
  }
  if (pad.padBottom > 0 && pad.padRight > 0) {
    ctx.drawImage(img, w - 1, h - 1, 1, 1, x + w, y + h, pad.padRight, pad.padBottom);
  }
}

/**
 * Corrige una imagen añadiendo padding sin reescalar píxeles.
 * 
 * @param {File} file - Archivo original
 * @param {object} options
 * @param {string} options.anchor - 'bottom-left', 'center', 'top-left'
 * @param {string} options.outputFormat - 'image/png' (default) o 'image/jpeg'
 * @param {boolean} options.clampEdgeJpg - Si se debe replicar borde para JPG
 * @returns {Promise<{ blob: Blob, newWidth: number, newHeight: number, padding: object }>}
 */
export async function padImageToMultipleOf4(file, options = {}) {
  const {
    anchor = 'bottom-left',
    outputFormat = 'image/png',
    clampEdgeJpg = false
  } = options;

  const img = await loadImageFromFile(file);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;

  const pad = calculatePadding(w, h, anchor);

  // Si ya es múltiplo de 4 y el formato coincide, devolver el archivo original directo
  if (pad.isAlreadyMultiple && (file.type === outputFormat || outputFormat === 'auto')) {
    return {
      blob: file,
      newWidth: w,
      newHeight: h,
      padding: pad,
      wasPadded: false
    };
  }

  // Crear canvas del tamaño objetivo
  const canvas = document.createElement('canvas');
  canvas.width = pad.targetWidth;
  canvas.height = pad.targetHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });

  // REGLA CRÍTICA: Desactivar suavizado/interpolación para transferencia 1:1 estricta
  ctx.imageSmoothingEnabled = false;

  const isJpeg = outputFormat === 'image/jpeg' || (outputFormat === 'auto' && (file.type === 'image/jpeg' || file.type === 'image/jpg'));

  if (isJpeg) {
    if (clampEdgeJpg) {
      // Replicar bordes de 1-3 píxeles
      applyEdgeClamping(ctx, img, pad.offsetX, pad.offsetY, w, h, pad);
    } else {
      // Fondo negro opaco por defecto para JPEG si no hay replicación
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, pad.targetWidth, pad.targetHeight);
    }
  } else {
    // Fondo 100% transparente (RGBA 0,0,0,0) para PNG / WebP
    ctx.clearRect(0, 0, pad.targetWidth, pad.targetHeight);
  }

  // Copia exacta 1:1 de los píxeles originales en las coordenadas del ancla
  ctx.drawImage(img, pad.offsetX, pad.offsetY, w, h);

  // Determinar MIME final de exportación
  const finalMime = isJpeg ? 'image/jpeg' : 'image/png';
  const quality = isJpeg ? 0.95 : undefined;

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Fallo al exportar el contenido del Canvas a Blob.'));
      },
      finalMime,
      quality
    );
  });

  return {
    blob,
    newWidth: pad.targetWidth,
    newHeight: pad.targetHeight,
    padding: pad,
    wasPadded: true
  };
}

/**
 * Formatea bytes en formato legible (B, KB, MB).
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
