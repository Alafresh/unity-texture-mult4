// =============================================================================
// App Coordinator: Manejo del DOM, eventos, estado y flujo de trabajo por lotes
// =============================================================================

import { 
  roundUpToMultipleOf4, 
  isMultipleOf4, 
  calculatePadding, 
  loadImageFromFile, 
  padImageToMultipleOf4, 
  formatBytes 
} from './image-processor.js';

import { createZip, triggerDownload } from './zip-export.js';

// Estado global de la aplicación
const state = {
  items: [], // Array de objetos TextureItem
  isProcessing: false,
};

// Referencias a elementos del DOM
const elements = {
  dropzone: document.getElementById('dropzone'),
  fileInput: document.getElementById('fileInput'),
  btnBrowse: document.getElementById('btnBrowse'),
  anchorSelect: document.getElementById('anchorSelect'),
  anchorHelpText: document.getElementById('anchorHelpText'),
  suffixInput: document.getElementById('suffixInput'),
  formatSelect: document.getElementById('formatSelect'),
  clampRow: document.getElementById('clampRow'),
  clampEdgeCheck: document.getElementById('clampEdgeCheck'),
  formatWarningText: document.getElementById('formatWarningText'),
  zipOnlyModifiedCheck: document.getElementById('zipOnlyModifiedCheck'),
  
  // Resumen
  statTotal: document.getElementById('statTotal'),
  statGood: document.getElementById('statGood'),
  statBad: document.getElementById('statBad'),
  statWeight: document.getElementById('statWeight'),
  
  // Botones en lote
  btnFixAll: document.getElementById('btnFixAll'),
  btnDownloadZip: document.getElementById('btnDownloadZip'),
  btnClearAll: document.getElementById('btnClearAll'),
  
  // Progreso
  progressContainer: document.getElementById('progressContainer'),
  progressText: document.getElementById('progressText'),
  progressPercent: document.getElementById('progressPercent'),
  progressBarFill: document.getElementById('progressBarFill'),
  
  // Contenedores
  imagesContainer: document.getElementById('imagesContainer'),
  emptyState: document.getElementById('emptyState')
};

/**
 * Inicialización al cargar el script
 */
function init() {
  setupEventListeners();
  updateUI();
}

/**
 * Configuración de todos los escuchadores de eventos
 */
function setupEventListeners() {
  // Arrastrar y soltar
  elements.dropzone.addEventListener('dragover', onDragOver);
  elements.dropzone.addEventListener('dragleave', onDragLeave);
  elements.dropzone.addEventListener('drop', onDrop);

  // Evitar apertura de imagen por defecto si se suelta fuera del dropzone
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // Click en zona o botón de examinar
  elements.btnBrowse.addEventListener('click', (e) => {
    e.stopPropagation();
    elements.fileInput.click();
  });
  elements.dropzone.addEventListener('click', () => elements.fileInput.click());
  elements.dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      elements.fileInput.click();
    }
  });

  elements.fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(Array.from(e.target.files));
      elements.fileInput.value = ''; // Resetear para permitir volver a cargar los mismos archivos
    }
  });

  // Soporte para pegar imágenes desde el portapapeles (Ctrl+V)
  window.addEventListener('paste', (e) => {
    const items = (e.clipboardData || e.originalEvent.clipboardData)?.items;
    if (!items) return;

    const files = [];
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }

    if (files.length > 0) {
      handleFiles(files);
    }
  });

  // Selector de ancla
  elements.anchorSelect.addEventListener('change', () => {
    const anchor = elements.anchorSelect.value;
    if (anchor === 'center') {
      elements.anchorHelpText.innerHTML = `
        <strong>⚠️ Nota sobre el centro:</strong> Centrar con un número impar de píxeles reparte el relleno (ej. 1 px a un lado y 2 px al otro), lo que desplaza el centro del contenido medio píxel. Para spritesheets y atlas, se recomienda el ancla <em>Inferior - Izquierda</em>.
      `;
    } else if (anchor === 'top-left') {
      elements.anchorHelpText.innerHTML = `
        <strong>Superior - Izquierda:</strong> El padding se añadirá a la derecha y abajo. Úsalo si tu shader o pipeline asume el origen en la esquina superior izquierda.
      `;
    } else {
      elements.anchorHelpText.innerHTML = `
        <strong>Recomendado para Unity:</strong> El Sprite Editor mide las coordenadas desde la esquina inferior-izquierda. Añadir el relleno arriba y a la derecha mantiene intactos los rectángulos de slicing en spritesheets y atlas existentes.
      `;
    }
    // Si hay items corregidos que dependen del ancla, permitir re-procesarlos
    resetPendingStatus();
  });

  // Formato de salida
  elements.formatSelect.addEventListener('change', () => {
    const isJpeg = elements.formatSelect.value === 'image/jpeg';
    elements.clampRow.style.display = isJpeg ? 'flex' : 'none';
    elements.formatWarningText.style.display = isJpeg ? 'block' : 'none';
    resetPendingStatus();
  });

  // Acciones en lote
  elements.btnFixAll.addEventListener('click', fixAllPending);
  elements.btnDownloadZip.addEventListener('click', downloadAllZip);
  elements.btnClearAll.addEventListener('click', clearAll);
}

function onDragOver(e) {
  e.preventDefault();
  elements.dropzone.classList.add('is-dragover');
}

function onDragLeave(e) {
  e.preventDefault();
  elements.dropzone.classList.remove('is-dragover');
}

function onDrop(e) {
  e.preventDefault();
  elements.dropzone.classList.remove('is-dragover');
  if (e.dataTransfer && e.dataTransfer.files) {
    handleFiles(Array.from(e.dataTransfer.files));
  }
}

/**
 * Procesa la lista de archivos seleccionados o arrastrados
 * @param {File[]} fileList
 */
async function handleFiles(fileList) {
  const validFiles = fileList.filter((f) => {
    return f.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp)$/i.test(f.name);
  });

  if (validFiles.length === 0) {
    alert('No se encontraron imágenes válidas (PNG, JPG, WebP o BMP).');
    return;
  }

  showProgress('Leyendo texturas...', 0);

  for (let i = 0; i < validFiles.length; i++) {
    const file = validFiles[i];
    showProgress(`Analizando ${file.name}...`, Math.round(((i + 1) / validFiles.length) * 100));

    try {
      const img = await loadImageFromFile(file);
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      const isGood = isMultipleOf4(width) && isMultipleOf4(height);

      const item = {
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        file,
        name: file.name,
        width,
        height,
        size: file.size,
        type: file.type,
        isGood,
        thumbnailUrl: img.src,
        status: isGood ? 'good' : 'pending',
        processedBlob: isGood ? file : null,
        processedWidth: isGood ? width : roundUpToMultipleOf4(width),
        processedHeight: isGood ? height : roundUpToMultipleOf4(height),
        processedSize: isGood ? file.size : null,
        padding: calculatePadding(width, height, elements.anchorSelect.value)
      };

      state.items.push(item);
    } catch (err) {
      console.error(err);
      state.items.push({
        id: `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        file,
        name: file.name,
        width: 0,
        height: 0,
        size: file.size,
        type: file.type,
        isGood: false,
        thumbnailUrl: '',
        status: 'error',
        errorMessage: err.message
      });
    }

    // Pequeño rendimiento al procesar lotes grandes para no congelar la UI
    if (i % 5 === 0) {
      await new Promise((r) => requestAnimationFrame(r));
    }
  }

  hideProgress();
  renderImages();
  updateUI();
}

/**
 * Corrige todas las imágenes que están en estado "MAL" o "pending"
 */
async function fixAllPending() {
  const pendingItems = state.items.filter((item) => item.status === 'pending');
  if (pendingItems.length === 0) return;

  state.isProcessing = true;
  updateUI();
  showProgress('Corrigiendo texturas...', 0);

  const anchor = elements.anchorSelect.value;
  const outputFormat = elements.formatSelect.value;
  const clampEdgeJpg = elements.clampEdgeCheck.checked;

  for (let i = 0; i < pendingItems.length; i++) {
    const item = pendingItems[i];
    showProgress(`Corrigiendo (${i + 1}/${pendingItems.length}): ${item.name}`, Math.round(((i + 1) / pendingItems.length) * 100));

    try {
      const result = await padImageToMultipleOf4(item.file, {
        anchor,
        outputFormat,
        clampEdgeJpg
      });

      item.status = 'done';
      item.processedBlob = result.blob;
      item.processedWidth = result.newWidth;
      item.processedHeight = result.newHeight;
      item.processedSize = result.blob.size;
      item.padding = result.padding;

      // Actualizar tarjeta en vivo
      updateCardElement(item);
    } catch (err) {
      console.error(err);
      item.status = 'error';
      item.errorMessage = err.message;
      updateCardElement(item);
    }

    // Ceder control al navegador entre imágenes
    await new Promise((r) => setTimeout(r, 10));
  }

  state.isProcessing = false;
  hideProgress();
  updateUI();
}

/**
 * Corrige un ítem individual
 * @param {object} item
 */
async function fixSingleItem(item) {
  item.status = 'processing';
  updateCardElement(item);

  try {
    const anchor = elements.anchorSelect.value;
    const outputFormat = elements.formatSelect.value;
    const clampEdgeJpg = elements.clampEdgeCheck.checked;

    const result = await padImageToMultipleOf4(item.file, {
      anchor,
      outputFormat,
      clampEdgeJpg
    });

    item.status = 'done';
    item.processedBlob = result.blob;
    item.processedWidth = result.newWidth;
    item.processedHeight = result.newHeight;
    item.processedSize = result.blob.size;
    item.padding = result.padding;
  } catch (err) {
    console.error(err);
    item.status = 'error';
    item.errorMessage = err.message;
  }

  updateCardElement(item);
  updateUI();
}

/**
 * Calcula el nombre de salida para una imagen según el sufijo y formato
 * @param {string} originalName
 * @param {boolean} isModified
 * @param {string} mimeType
 * @returns {string}
 */
function getExportFilename(originalName, isModified, mimeType) {
  const lastDot = originalName.lastIndexOf('.');
  const baseName = lastDot !== -1 ? originalName.substring(0, lastDot) : originalName;
  const originalExt = lastDot !== -1 ? originalName.substring(lastDot) : '';
  
  const suffix = isModified ? elements.suffixInput.value.trim() : '';

  // Determinar extensión final
  let targetExt = originalExt;
  if (mimeType === 'image/png') {
    targetExt = '.png';
  } else if (mimeType === 'image/jpeg') {
    targetExt = '.jpg';
  }

  return `${baseName}${suffix}${targetExt}`;
}

/**
 * Descarga una sola imagen
 * @param {object} item
 */
function downloadSingleItem(item) {
  const blobToDownload = item.processedBlob || item.file;
  const isModified = item.status === 'done';
  const filename = getExportFilename(item.name, isModified, blobToDownload.type);
  triggerDownload(blobToDownload, filename);
}

/**
 * Empaqueta y descarga las imágenes en un archivo ZIP
 */
async function downloadAllZip() {
  const onlyModified = elements.zipOnlyModifiedCheck.checked;
  
  // Si aún hay elementos pendientes de corrección, corregirlos primero
  const pendingItems = state.items.filter((item) => item.status === 'pending');
  if (pendingItems.length > 0) {
    const confirmFix = confirm(`Hay ${pendingItems.length} texturas pendientes de corrección. ¿Deseas corregirlas automáticamente antes de generar el ZIP?`);
    if (confirmFix) {
      await fixAllPending();
    }
  }

  let itemsToZip = state.items.filter((item) => item.status !== 'error');

  if (onlyModified) {
    itemsToZip = itemsToZip.filter((item) => item.status === 'done');
  }

  if (itemsToZip.length === 0) {
    alert(onlyModified 
      ? 'No hay imágenes corregidas para incluir en el ZIP. (Desmarca "Incluir solo imágenes corregidas" si deseas incluir las que ya estaban bien).'
      : 'No hay imágenes para empaquetar.');
    return;
  }

  showProgress('Preparando archivo .ZIP...', 0);

  const filesForZip = itemsToZip.map((item) => {
    const blob = item.processedBlob || item.file;
    const isModified = item.status === 'done';
    const name = getExportFilename(item.name, isModified, blob.type);
    return { name, blob };
  });

  try {
    const zipBlob = await createZip(filesForZip, (current, total) => {
      showProgress(`Comprimiendo (${current}/${total})...`, Math.round((current / total) * 100));
    });

    const timestamp = new Date().toISOString().slice(0, 10);
    triggerDownload(zipBlob, `unity_textures_m4_${timestamp}.zip`);
  } catch (err) {
    console.error(err);
    alert(`Error al generar el ZIP: ${err.message}`);
  } finally {
    hideProgress();
  }
}

/**
 * Elimina una imagen de la lista
 * @param {string} id
 */
function deleteItem(id) {
  const index = state.items.findIndex((item) => item.id === id);
  if (index !== -1) {
    state.items.splice(index, 1);
    renderImages();
    updateUI();
  }
}

/**
 * Limpia toda la lista
 */
function clearAll() {
  if (state.items.length === 0) return;
  if (confirm('¿Deseas vaciar la lista de imágenes?')) {
    state.items = [];
    renderImages();
    updateUI();
  }
}

/**
 * Si se cambia el ancla o formato, vuelve a marcar los ya corregidos como pendientes
 */
function resetPendingStatus() {
  state.items.forEach((item) => {
    if (!item.isGood) {
      item.status = 'pending';
      item.padding = calculatePadding(item.width, item.height, elements.anchorSelect.value);
    }
  });
  renderImages();
  updateUI();
}

/**
 * Muestra barra de progreso
 */
function showProgress(text, percent) {
  elements.progressContainer.style.display = 'block';
  elements.progressText.textContent = text;
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressBarFill.style.width = `${percent}%`;
}

/**
 * Oculta barra de progreso
 */
function hideProgress() {
  elements.progressContainer.style.display = 'none';
  elements.progressBarFill.style.width = '0%';
}

/**
 * Actualiza contadores y estados de botones
 */
function updateUI() {
  const total = state.items.length;
  const good = state.items.filter((i) => i.isGood).length;
  const bad = state.items.filter((i) => !i.isGood && i.status !== 'error').length;
  const pending = state.items.filter((i) => i.status === 'pending').length;
  const done = state.items.filter((i) => i.status === 'done').length;

  const totalBytes = state.items.reduce((acc, i) => acc + (i.processedSize || i.size || 0), 0);

  elements.statTotal.textContent = `Total: ${total}`;
  elements.statGood.textContent = `${good} BIEN`;
  elements.statBad.textContent = `${bad} MAL`;
  elements.statWeight.textContent = `Peso: ${formatBytes(totalBytes)}`;

  elements.btnFixAll.disabled = pending === 0 || state.isProcessing;
  elements.btnDownloadZip.disabled = total === 0 || state.isProcessing;
  elements.btnClearAll.disabled = total === 0 || state.isProcessing;

  elements.emptyState.style.display = total === 0 ? 'block' : 'none';
}

/**
 * Renderiza todas las tarjetas en el contenedor
 */
function renderImages() {
  elements.imagesContainer.querySelectorAll('.image-card').forEach((el) => el.remove());

  for (const item of state.items) {
    const card = createCardElement(item);
    elements.imagesContainer.appendChild(card);
  }
}

/**
 * Crea el elemento DOM para una tarjeta de imagen
 * @param {object} item
 * @returns {HTMLElement}
 */
function createCardElement(item) {
  const card = document.createElement('article');
  card.className = `image-card ${item.isGood ? 'is-good' : 'is-bad'}`;
  card.id = `card_${item.id}`;

  if (item.status === 'error') {
    card.innerHTML = `
      <div class="card-thumbnail">⚠️</div>
      <div class="card-info">
        <span class="card-filename">${escapeHtml(item.name)}</span>
        <span class="badge" style="background: var(--status-error-bg); color: var(--status-error-text); border: 1px solid var(--status-error-border);">ERROR</span>
        <p class="card-padding-detail" style="color: var(--status-error-text);">${escapeHtml(item.errorMessage || 'Error desconocido')}</p>
      </div>
      <div class="card-actions">
        <button type="button" class="btn-icon btn-icon-delete" data-action="delete" title="Eliminar de la lista">✕</button>
      </div>
    `;
    card.querySelector('[data-action="delete"]').addEventListener('click', () => deleteItem(item.id));
    return card;
  }

  const targetW = item.processedWidth || roundUpToMultipleOf4(item.width);
  const targetH = item.processedHeight || roundUpToMultipleOf4(item.height);
  const padW = targetW - item.width;
  const padH = targetH - item.height;

  let badgeHtml = '';
  let dimHtml = '';
  let paddingDetailHtml = '';

  if (item.isGood) {
    badgeHtml = `<span class="badge badge-good">✓ BIEN (Múltiplo de 4)</span>`;
    dimHtml = `<span class="card-dimensions">${item.width} × ${item.height} px</span>`;
    paddingDetailHtml = `<span>No requiere relleno. Compatible directamente con DXT5/BC3.</span>`;
  } else if (item.status === 'done') {
    badgeHtml = `<span class="badge badge-good">✓ CORREGIDA (+${padW}×+${padH} px)</span>`;
    dimHtml = `<span class="card-dimensions">${item.width} × ${item.height} px <span class="dim-arrow">→</span> <strong>${targetW} × ${targetH} px</strong></span>`;
    paddingDetailHtml = `<span>Relleno aplicado 1:1 sin reescalar (${formatBytes(item.processedSize)}).</span>`;
  } else {
    badgeHtml = `<span class="badge badge-bad">⚠️ MAL (No es múltiplo de 4)</span>`;
    dimHtml = `<span class="card-dimensions">${item.width} × ${item.height} px <span class="dim-arrow">→</span> <strong>${targetW} × ${targetH} px</strong></span>`;
    paddingDetailHtml = `<span>Añadirá +${padW} px de ancho y +${padH} px de alto sin interpolar.</span>`;
  }

  card.innerHTML = `
    <div class="card-thumbnail">
      <img src="${item.thumbnailUrl}" alt="Miniatura de ${escapeHtml(item.name)}" loading="lazy">
    </div>
    <div class="card-info">
      <div class="card-filename" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</div>
      <div class="card-meta">
        ${badgeHtml}
        ${dimHtml}
        <span>${formatBytes(item.size)}</span>
      </div>
      <div class="card-padding-detail">
        ${paddingDetailHtml}
      </div>
    </div>
    <div class="card-actions">
      ${!item.isGood && item.status === 'pending' ? `
        <button type="button" class="btn-icon" data-action="fix" title="Corregir esta imagen">✨ Corregir</button>
      ` : ''}
      <button type="button" class="btn-icon" data-action="download" title="Descargar imagen">
        ⬇️ ${item.status === 'done' ? 'Descargar corregida' : 'Descargar'}
      </button>
      <button type="button" class="btn-icon btn-icon-delete" data-action="delete" title="Eliminar de la lista">✕</button>
    </div>
  `;

  // Asignar eventos de botones
  const btnFix = card.querySelector('[data-action="fix"]');
  if (btnFix) {
    btnFix.addEventListener('click', () => fixSingleItem(item));
  }

  card.querySelector('[data-action="download"]').addEventListener('click', () => downloadSingleItem(item));
  card.querySelector('[data-action="delete"]').addEventListener('click', () => deleteItem(item.id));

  return card;
}

/**
 * Actualiza una tarjeta existente sin re-renderizar toda la lista
 * @param {object} item
 */
function updateCardElement(item) {
  const existingCard = document.getElementById(`card_${item.id}`);
  if (existingCard) {
    const newCard = createCardElement(item);
    existingCard.replaceWith(newCard);
  }
}

/**
 * Escapa texto HTML para evitar inyecciones en nombres de archivo
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, (tag) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

// Iniciar aplicación
document.addEventListener('DOMContentLoaded', init);
