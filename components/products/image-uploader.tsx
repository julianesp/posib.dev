'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Upload, X, Image as ImageIcon, Loader2, Camera, Star } from 'lucide-react';
import { toast } from 'sonner';
import imageCompression from 'browser-image-compression';
import Swal from 'sweetalert2';

interface ImageUploaderProps {
  productId?: string;
  initialImages?: string[];
  onChange: (images: string[]) => void;
  onMainImageChange?: (mainImageIndex: number) => void;
  initialMainImageIndex?: number;
  maxImages?: number;
}

export function ImageUploader({
  productId,
  initialImages = [],
  onChange,
  onMainImageChange,
  initialMainImageIndex = 0,
  maxImages = 4,
}: ImageUploaderProps) {
  const [images, setImages] = useState<string[]>(initialImages);
  const [mainImageIndex, setMainImageIndex] = useState<number>(initialMainImageIndex);
  const [uploading, setUploading] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Sincronizar estado interno con initialImages cuando cambien
  useEffect(() => {
    setImages(initialImages);
  }, [initialImages]);

  // Sincronizar mainImageIndex
  useEffect(() => {
    setMainImageIndex(initialMainImageIndex);
  }, [initialMainImageIndex]);

  // Manejar cambio de imagen principal
  const handleSetMainImage = (index: number) => {
    setMainImageIndex(index);
    if (onMainImageChange) {
      onMainImageChange(index);
    }
    toast.success('Imagen principal actualizada');
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (images.length >= maxImages) {
      toast.warning(
        maxImages === 1
          ? 'Ya tienes una imagen. Elimínala para agregar otra'
          : `Máximo ${maxImages} imágenes permitidas. Elimina una para agregar otra`
      );
      return;
    }

    const remainingSlots = maxImages - images.length;
    const filesToUpload = Array.from(files).slice(0, remainingSlots);

    setUploading(true);

    try {
      const uploadPromises = filesToUpload.map(async (file, index) => {
        try {
          // Lista de extensiones válidas
          const validExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'tiff', 'tif', 'avif', 'heic', 'heif'];
          const validMimeTypes = [
            'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
            'image/bmp', 'image/svg+xml', 'image/tiff', 'image/avif',
            'image/heic', 'image/heif', 'image/x-icon'
          ];

          // Obtener extensión del archivo
          const fileExtension = file.name.split('.').pop()?.toLowerCase() || '';

          // Validar por tipo MIME o por extensión (más permisivo)
          const isValidMimeType = file.type.startsWith('image/') || validMimeTypes.includes(file.type);
          const isValidExtension = validExtensions.includes(fileExtension);

          console.log('📋 Validación de archivo:', {
            nombre: file.name,
            tipo: file.type,
            extensión: fileExtension,
            tamañoMB: (file.size / 1024 / 1024).toFixed(2),
            validMime: isValidMimeType,
            validExt: isValidExtension
          });

          if (!isValidMimeType && !isValidExtension) {
            toast.error(`Formato no soportado: ${file.name}. Usa: JPG, PNG, GIF, WebP, BMP, SVG, TIFF, AVIF, HEIC`);
            return null;
          }

          setLoadingIndex(images.length + index);

          console.log('📸 Imagen:', {
            nombre: file.name,
            tamaño: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
            tipo: file.type
          });

          // Validar tamaño (máximo 5MB)
          if (file.size > 5 * 1024 * 1024) {
            toast.error(`Imagen muy grande (máx 5MB). Archivo: ${file.name}`);
            return null;
          }

          // Usar endpoint de Next.js que maneja la subida con firma
          const formData = new FormData();
          formData.append('file', file);
          formData.append('folder', `products/${productId || 'temp'}`);

          // Subir a través del endpoint de Next.js
          console.log('📤 Subiendo a servidor...');
          toast.info('Subiendo imagen...', { duration: 2000 });

          const response = await fetch('/api/upload-image', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            console.error('❌ Error del servidor:', {
              status: response.status,
              statusText: response.statusText,
              error: errorData
            });

            // Mensajes más específicos según el error
            let errorMessage = 'Error al subir imagen';
            if (response.status === 401) {
              errorMessage = 'No estás autorizado. Intenta cerrar sesión y volver a entrar.';
            } else if (response.status === 400) {
              errorMessage = errorData.error || 'La imagen no es válida';
            } else if (response.status === 500) {
              errorMessage = 'Error en el servidor. Intenta de nuevo.';
            } else {
              errorMessage = errorData.error || `Error ${response.status}`;
            }

            throw new Error(errorMessage);
          }

          const data = await response.json();
          if (!data.success || !data.secure_url) {
            console.error('❌ Respuesta inválida:', data);
            throw new Error('Respuesta inválida del servidor');
          }

          console.log('✅ Imagen subida exitosamente:', data.secure_url);
          return data.secure_url;
        } catch (error) {
          console.error('❌ Error procesando imagen:', error);
          toast.error(error instanceof Error ? error.message : `Error al procesar ${file.name}`);
          return null;
        }
      });

      const uploadedUrls = (await Promise.all(uploadPromises)).filter(
        (url): url is string => url !== null
      );

      const newImages = [...images, ...uploadedUrls];
      setImages(newImages);
      onChange(newImages);

      if (uploadedUrls.length > 0) {
        toast.success(
          uploadedUrls.length === 1
            ? 'Imagen subida correctamente'
            : `${uploadedUrls.length} imágenes subidas correctamente`
        );
      }
    } catch (error) {
      console.error('Error uploading images:', error);
      toast.error(maxImages === 1 ? 'Error al subir imagen. Intenta de nuevo' : 'Error al subir imágenes. Intenta de nuevo');
    } finally {
      setUploading(false);
      setLoadingIndex(null);
      // Resetear el input
      e.target.value = '';
    }
  };

  const handleRemoveImage = async (index: number) => {
    const imageUrl = images[index];

    try {
      // Extraer public_id de la URL de Cloudinary
      const urlParts = imageUrl.split('/');
      const uploadIndex = urlParts.indexOf('upload');
      if (uploadIndex !== -1) {
        const pathAfterUpload = urlParts.slice(uploadIndex + 2).join('/');
        const publicId = pathAfterUpload.split('.')[0];

        // Intentar eliminar de Cloudinary (opcional, requiere endpoint backend)
        // Por ahora solo removemos de la lista
        console.log('Public ID to delete:', publicId);
      }

      const newImages = images.filter((_, i) => i !== index);
      setImages(newImages);
      onChange(newImages);

      // Ajustar el índice de la imagen principal si es necesario
      let newMainIndex = mainImageIndex;
      if (index === mainImageIndex) {
        // Si eliminamos la imagen principal, la primera imagen será la nueva principal
        newMainIndex = 0;
      } else if (index < mainImageIndex) {
        // Si eliminamos una imagen antes de la principal, ajustar el índice
        newMainIndex = mainImageIndex - 1;
      }

      if (newMainIndex !== mainImageIndex && onMainImageChange) {
        setMainImageIndex(newMainIndex);
        onMainImageChange(newMainIndex);
      }

      toast.success('Imagen eliminada');
    } catch (error) {
      console.error('Error removing image:', error);
      toast.error('Error al eliminar imagen. Intenta de nuevo');
    }
  };

  // Iniciar cámara
  const startCamera = async () => {
    try {
      // Verificar si el navegador soporta getUserMedia
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        toast.error('Tu navegador no soporta el acceso a la cámara. Usa la opción de Galería.');
        return;
      }

      // Mostrar modal primero
      setShowCamera(true);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false
      });

      streamRef.current = stream;

      // Esperar un tick para que el DOM se actualice y videoRef esté disponible
      await new Promise(resolve => setTimeout(resolve, 100));

      if (videoRef.current) {
        const video = videoRef.current;
        video.srcObject = stream;

        console.log('📹 Stream asignado al video');

        // Promesa para esperar a que el video esté listo
        const waitForVideo = new Promise<void>((resolve) => {
          const handleVideoReady = () => {
            console.log('✅ Video listo - Estado:', {
              readyState: video.readyState,
              width: video.videoWidth,
              height: video.videoHeight,
              paused: video.paused
            });

            if (video.videoWidth > 0 && video.videoHeight > 0) {
              setCameraReady(true);
              resolve();
            }
          };

          // Usar solo el evento más confiable
          video.addEventListener('loadedmetadata', handleVideoReady, { once: true });

          // Timeout de respaldo
          setTimeout(() => {
            console.log('⏰ Timeout - verificando estado del video');
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              setCameraReady(true);
              resolve();
            } else {
              console.error('❌ Video sin dimensiones después de 3s');
              // Intentar de todos modos
              setCameraReady(true);
              resolve();
            }
          }, 3000);
        });

        // Intentar reproducir inmediatamente
        try {
          await video.play();
          console.log('✅ Play() exitoso');
        } catch (err) {
          console.warn('⚠️ Play() falló:', err);
        }

        // Esperar a que el video esté listo
        await waitForVideo;
      }
    } catch (error) {
      console.error('Error accessing camera:', error);
      setShowCamera(false);
      setCameraReady(false);

      // Mensajes de error más específicos y amigables
      let errorMessage = 'No se pudo acceder a la cámara.';
      const errorName = error instanceof Error ? error.name : '';

      if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        // Mostrar un modal con instrucciones detalladas
        Swal.fire({
          icon: 'warning',
          title: '⚠️ Permiso de Cámara Requerido',
          html: `
            <div class="text-left space-y-3">
              <p class="text-sm text-gray-700 mb-3">
                Para usar la cámara, debes dar permiso en tu navegador.
              </p>

              <div class="bg-brand-light/50 border-l-4 border-brand p-3 mb-3">
                <p class="text-sm font-semibold text-brand mb-2">📱 Cómo dar permisos:</p>
                <ol class="text-xs text-brand space-y-2 list-decimal list-inside">
                  <li>Toca el <strong>ícono del candado 🔒</strong> o la <strong>i de información ℹ️</strong> en la barra de direcciones</li>
                  <li>Busca la opción <strong>"Cámara"</strong> o <strong>"Camera"</strong></li>
                  <li>Selecciona <strong>"Permitir"</strong> o <strong>"Allow"</strong></li>
                  <li>Recarga la página tocando el botón de recargar 🔄</li>
                  <li>Vuelve a presionar <strong>"Tomar Foto"</strong></li>
                </ol>
              </div>

              <div class="bg-yellow-50 border border-yellow-200 rounded p-2">
                <p class="text-xs text-yellow-800">
                  <strong>💡 Alternativa:</strong> Si no puedes dar permisos, usa el botón <strong>"Galería"</strong> para subir fotos desde tu dispositivo.
                </p>
              </div>
            </div>
          `,
          confirmButtonText: 'Entendido',
          confirmButtonColor: '#3B82F6',
          showCancelButton: true,
          cancelButtonText: 'Usar Galería',
          cancelButtonColor: '#10B981',
        }).then((result) => {
          if (result.isDismissed && result.dismiss === Swal.DismissReason.cancel) {
            // Usuario eligió usar galería - trigger el input file
            document.getElementById('image-upload')?.click();
          }
        });
        return;
      } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        errorMessage = '📷 No se encontró ninguna cámara en tu dispositivo. Usa la opción de Galería.';
      } else if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
        errorMessage = '⚠️ La cámara está siendo usada por otra aplicación. Cierra otras aplicaciones y intenta de nuevo.';
      } else if (errorName === 'OverconstrainedError' || errorName === 'ConstraintNotSatisfiedError') {
        errorMessage = '⚠️ No se pudo configurar la cámara con los ajustes solicitados. Intenta de nuevo.';
      } else if (errorName === 'SecurityError') {
        errorMessage = '🔒 Acceso a la cámara bloqueado por seguridad. Asegúrate de estar usando HTTPS y verifica los permisos.';
      }

      if (errorMessage) {
        toast.error(errorMessage, { duration: 6000 });
      }
    }
  };

  // Detener cámara
  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
    setShowCamera(false);
  };

  // Tomar foto
  const capturePhoto = async () => {
    try {
      if (!videoRef.current || !canvasRef.current) {
        toast.error('Error: Cámara no inicializada correctamente');
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;

      // Verificar que el video esté listo y tenga dimensiones
      if (video.readyState !== video.HAVE_ENOUGH_DATA) {
        toast.error('Espera un momento, la cámara aún se está inicializando...');
        return;
      }

      if (video.videoWidth === 0 || video.videoHeight === 0) {
        toast.error('Error: No se pudo obtener la imagen de la cámara');
        console.error('Video dimensions:', video.videoWidth, video.videoHeight);
        return;
      }

      const context = canvas.getContext('2d');
      if (!context) {
        toast.error('Error al inicializar el canvas');
        return;
      }

      // Configurar canvas al tamaño del video
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      console.log('📸 Capturando foto:', { width: canvas.width, height: canvas.height });

      // Dibujar el frame actual del video en el canvas
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Convertir canvas a blob
      canvas.toBlob(async (blob) => {
        if (!blob) {
          toast.error('Error al capturar foto. Intenta de nuevo.');
          return;
        }

        console.log('✅ Foto capturada:', { size: `${(blob.size / 1024).toFixed(2)} KB` });

        // Crear archivo desde el blob
        const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });

        // Detener cámara
        stopCamera();

        // Subir la foto
        setUploading(true);
        try {
          const formData = new FormData();
          formData.append('file', file);
          formData.append('folder', `products/${productId || 'temp'}`);

          toast.info('Subiendo foto...', { duration: 2000 });

          const response = await fetch('/api/upload-image', {
            method: 'POST',
            body: formData,
          });

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error al subir imagen');
          }

          const data = await response.json();
          if (!data.success || !data.secure_url) {
            throw new Error('Respuesta inválida del servidor');
          }

          const newImages = [...images, data.secure_url];
          setImages(newImages);
          onChange(newImages);

          toast.success('Foto agregada correctamente');
        } catch (error) {
          console.error('Error uploading photo:', error);
          toast.error(error instanceof Error ? error.message : 'Error al subir foto. Intenta de nuevo.');
        } finally {
          setUploading(false);
        }
      }, 'image/jpeg', 0.9);
    } catch (error) {
      console.error('Error in capturePhoto:', error);
      toast.error('Error al capturar foto: ' + (error instanceof Error ? error.message : 'Error desconocido'));
    }
  };

  // Reproducir video cuando el modal se abre (respaldo)
  useEffect(() => {
    if (showCamera && videoRef.current && streamRef.current) {
      const video = videoRef.current;

      const checkAndPlay = async () => {
        console.log('🔄 useEffect - Verificando video:', {
          readyState: video.readyState,
          paused: video.paused,
          srcObject: !!video.srcObject
        });

        if (video.paused) {
          try {
            await video.play();
            console.log('✅ Video reproducido desde useEffect');
          } catch (err) {
            console.warn('⚠️ No se pudo reproducir desde useEffect:', err);
          }
        }
      };

      // Intentar reproducir después de un delay
      const timer = setTimeout(checkAndPlay, 500);

      return () => clearTimeout(timer);
    }
  }, [showCamera]);

  // Limpiar stream al desmontar
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  return (
    <div className="space-y-4">
      {/* Grid de imágenes */}
      <div className={`grid gap-4 ${maxImages === 1 ? 'grid-cols-1 max-w-xs mx-auto' : 'grid-cols-2 sm:grid-cols-4'}`}>
        {images.map((imageUrl, index) => (
          <Card key={index} className={`relative group ${index === mainImageIndex ? 'ring-2 ring-yellow-500' : ''}`}>
            <CardContent className="p-2">
              <div className="relative aspect-square overflow-hidden rounded-md">
                <Image
                  src={imageUrl}
                  alt={`Producto imagen ${index + 1}`}
                  fill
                  sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 200px"
                  className="object-cover"
                  loading="lazy"
                />

                {/* Badge de imagen principal */}
                {index === mainImageIndex && (
                  <div className="absolute top-1 left-1 bg-yellow-500 text-white px-2 py-0.5 rounded-md text-xs font-semibold flex items-center gap-1 z-10">
                    <Star className="h-3 w-3 fill-white" />
                    Principal
                  </div>
                )}

                {/* Botones de acción */}
                <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  {/* Botón para establecer como principal */}
                  {maxImages > 1 && index !== mainImageIndex && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon"
                      className="h-7 w-7 bg-yellow-500 hover:bg-yellow-600 text-white"
                      onClick={() => handleSetMainImage(index)}
                      title="Establecer como imagen principal"
                    >
                      <Star className="h-4 w-4" />
                    </Button>
                  )}

                  {/* Botón para eliminar */}
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => handleRemoveImage(index)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              <p className="text-xs text-center text-gray-500 mt-1">
                {maxImages === 1 ? 'Vista previa' : index === mainImageIndex ? 'Imagen Principal' : `Imagen ${index + 1}`}
              </p>
            </CardContent>
          </Card>
        ))}

        {/* Placeholders para slots vacíos */}
        {Array.from({ length: maxImages - images.length }).map((_, index) => (
          <Card key={`empty-${index}`} className="border-dashed">
            <CardContent className="p-2">
              <div className="aspect-square flex items-center justify-center bg-gray-50 rounded-md">
                {loadingIndex === images.length + index ? (
                  <Loader2 className="h-8 w-8 text-brand animate-spin" />
                ) : (
                  <ImageIcon className="h-8 w-8 text-gray-300" />
                )}
              </div>
              {maxImages > 1 && (
                <p className="text-xs text-center text-gray-400 mt-1">
                  {images.length + index + 1}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Botones de subida */}
      {images.length < maxImages && (
        <div className="space-y-3">
          {/* Input oculto para selección de archivos */}
          <input
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/gif,image/webp,image/bmp,image/svg+xml,image/tiff,image/avif,image/heic,image/heif,.jpg,.jpeg,.png,.gif,.webp,.bmp,.svg,.tiff,.tif,.avif,.heic,.heif"
            multiple
            onChange={handleFileSelect}
            className="hidden"
            id="image-upload"
            disabled={uploading}
          />

          {/* Mensaje informativo */}
          <div className="bg-brand-light/50 border border-brand/40 rounded-lg p-3">
            <p className="text-xs text-brand font-medium mb-1">
              💡 Consejos para las imágenes:
            </p>
            <ul className="text-xs text-brand space-y-1 list-disc list-inside">
              <li>La primera imagen será la principal (se muestra en la tienda online)</li>
              <li>Puedes cambiar la imagen principal haciendo clic en la estrella</li>
              <li>Agrega hasta {maxImages} imágenes para mostrar diferentes ángulos</li>
            </ul>
          </div>

          {/* Botones principales */}
          <div className="grid grid-cols-2 gap-3">
            {/* Botón de cámara */}
            <Button
              type="button"
              onClick={startCamera}
              disabled={uploading}
              className="w-full bg-purple-600 hover:bg-purple-700 h-auto py-3"
            >
              <div className="flex flex-col items-center gap-1">
                <Camera className="h-5 w-5" />
                <span className="text-sm">Tomar Foto</span>
              </div>
            </Button>

            {/* Botón de galería */}
            <label
              htmlFor="image-upload"
              className={`inline-flex flex-col items-center justify-center gap-1 rounded-md border border-gray-300 bg-brand text-white px-4 py-3 text-sm font-medium transition-colors hover:bg-brand-hover ${
                uploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              }`}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-sm">Subiendo...</span>
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5" />
                  <span className="text-sm">Galería</span>
                </>
              )}
            </label>
          </div>

          <p className="text-xs text-gray-500 text-center">
            {images.length}/{maxImages} {maxImages === 1 ? 'imagen' : 'imágenes'} • JPG, PNG, GIF, WebP, BMP, SVG, TIFF, AVIF, HEIC • Máx 5MB
          </p>
        </div>
      )}

      {/* Estado completo */}
      {images.length === maxImages && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <p className="text-sm text-green-800 text-center">
            ✓ {maxImages === 1 ? 'Imagen agregada' : `Máximo de imágenes alcanzado (${maxImages}/${maxImages})`}
          </p>
        </div>
      )}

      {/* Modal de Cámara */}
      {showCamera && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-3xl w-full overflow-hidden">
            {/* Header */}
            <div className="bg-purple-600 text-white p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="h-6 w-6" />
                <h2 className="text-xl font-bold">Tomar Foto del Producto</h2>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={stopCamera}
                className="text-white hover:bg-purple-700"
              >
                <X className="h-6 w-6" />
              </Button>
            </div>

            {/* Video preview */}
            <div className="relative bg-black min-h-[300px] flex items-center justify-center">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full max-h-[60vh] object-contain"
              />

              {/* Loader mientras carga el video */}
              {!cameraReady && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-white text-center">
                    <Loader2 className="h-12 w-12 animate-spin mx-auto mb-3" />
                    <p className="text-sm">Iniciando cámara...</p>
                  </div>
                </div>
              )}

              {/* Canvas oculto para capturar la imagen */}
              <canvas ref={canvasRef} className="hidden" />

              {/* Guías visuales */}
              <div className="absolute inset-0 pointer-events-none">
                <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 border-2 border-white border-dashed w-3/4 h-3/4 rounded-lg opacity-50"></div>
              </div>
            </div>

            {/* Footer con botones */}
            <div className="p-4 bg-gray-50">
              {/* Indicador de estado de cámara */}
              {!cameraReady && !uploading && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2 mb-3">
                  <p className="text-xs text-yellow-800 text-center flex items-center justify-center gap-2">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Iniciando cámara, espera un momento...
                  </p>
                </div>
              )}

              <div className="flex gap-3 justify-center">
                <Button
                  type="button"
                  onClick={stopCamera}
                  variant="outline"
                  className="min-w-[120px]"
                >
                  Cancelar
                </Button>
                <Button
                  type="button"
                  onClick={capturePhoto}
                  disabled={!cameraReady || uploading}
                  className="min-w-[120px] bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Subiendo...
                    </>
                  ) : !cameraReady ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Preparando...
                    </>
                  ) : (
                    <>
                      <Camera className="mr-2 h-4 w-4" />
                      Capturar Foto
                    </>
                  )}
                </Button>
              </div>
              <p className="text-xs text-gray-500 text-center mt-3">
                {cameraReady
                  ? 'Centra el producto dentro del recuadro y presiona Capturar Foto'
                  : 'Espera a que la cámara esté lista antes de capturar'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
