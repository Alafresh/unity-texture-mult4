# Unity Texture Mult4

Herramienta web ligera y local para adaptar dimensiones de texturas a múltiplos de 4, resolviendo el requerimiento de compresión DXT1, DXT5 (BC3) y BC7 en Unity sin degradar la calidad gráfica.

---

## ¿Por qué existe esta herramienta?

Los formatos de compresión de textura en GPU (como la familia DXT y BC) procesan los gráficos en bloques de 4×4 píxeles. Cuando una textura no tiene dimensiones divisibles entre cuatro (por ejemplo, 2048×498 px), Unity emite una advertencia y desactiva la compresión de bloque, provocando un consumo excesivo de memoria VRAM en tiempo de ejecución.

### Enfoque sin pérdida de calidad (Padding 1:1)
A diferencia de los editores convencionales que aplican remuestreo e interpolación (bilineal o bicúbica):
* **Cero reescalado:** No se alteran ni emborronan los píxeles originales.
* **Preservación de alfa:** Se agrega un margen transparente (RGBA 0,0,0,0) de 1 a 3 píxeles en PNG.
* **Clamp-to-edge en JPG:** Opción para duplicar la última fila o columna, evitando bordes oscuros en el filtrado de texturas.
* **Respeto al Sprite Editor de Unity:** Por defecto, el relleno vertical se coloca en la parte superior y el horizontal a la derecha. Esto se alinea con el sistema de coordenadas de Unity (origen en la esquina inferior izquierda) y evita que los rectángulos de recorte en atlas existentes se desfasen.

---

## Instrucciones de uso

1. **Cargar imágenes:** Arrastra tus archivos PNG, JPG, WebP o BMP a la zona punteada, o pulsa el botón para seleccionarlos. También puedes pegar imágenes directamente con `Ctrl + V`.
2. **Revisar diagnóstico:** La herramienta clasifica de inmediato cada archivo como **BIEN** (ambas dimensiones son múltiplos de 4) o **MAL** (muestra las dimensiones actuales y las sugeridas).
3. **Ajustar opciones:**
   * **Posición del ancla:** Selecciona dónde ubicar el relleno (la opción *Inferior - Izquierda* es la idónea para sprites en Unity).
   * **Sufijo de archivo:** Por defecto añade `_m4`. Si prefieres sustituir el archivo original dentro de la carpeta `Assets/` de tu proyecto Unity sin romper referencias ni perder su archivo `.meta`, deja este campo en blanco.
   * **Formato de salida:** PNG (recomendado) o JPG con replicación de borde.
4. **Procesar y descargar:**
   * Corrige imágenes de forma individual o pulsa **Corregir todas las pendientes**.
   * Descarga los archivos corregidos individualmente o agrupados en un archivo `.zip`.

---

## Despliegue en GitHub Pages

Este proyecto consta de archivos estáticos puros (HTML, CSS y JavaScript ES Modules) y no requiere ningún paso de compilación o backend.

1. Sube el repositorio a tu cuenta de GitHub.
2. En GitHub, ve a la pestaña **Settings** del repositorio.
3. En el menú lateral izquierdo, selecciona **Pages**.
4. En la sección **Build and deployment**:
   * **Source:** Selecciona `Deploy from a branch`.
   * **Branch:** Selecciona `main` (o tu rama principal) y la carpeta `/(root)`.
5. Haz clic en **Save**.
6. En un par de minutos, GitHub te proporcionará la URL pública de la aplicación.

---

## Privacidad y rendimiento

Todo el procesamiento ocurre exclusivamente en la memoria del navegador mediante la Canvas API. Ningún archivo se transmite ni se almacena en servidores externos.

---

Licencia: MIT (ver archivo LICENSE)
