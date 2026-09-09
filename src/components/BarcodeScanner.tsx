import { useEffect, useRef, useState } from 'react'

// BarcodeDetector nativo quando existe; senão ZXing (import dinâmico);
// e há sempre o campo manual para escrever o EAN.
interface DetectedBarcode {
  rawValue: string
}
interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<DetectedBarcode[]>
}
declare global {
  interface Window {
    BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorLike
  }
}

const EAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']

export default function BarcodeScanner({
  onDetect,
  onClose,
}: {
  onDetect: (ean: string) => void
  onClose: () => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [manual, setManual] = useState('')
  const [cameraError, setCameraError] = useState(false)

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | null = null
    let zxingControls: { stop: () => void } | null = null
    let timer: ReturnType<typeof setInterval> | null = null

    function found(raw: string) {
      const ean = raw.replace(/\D/g, '')
      if (stopped || !/^\d{8,14}$/.test(ean)) return
      stopped = true
      onDetect(ean)
    }

    async function start() {
      const video = videoRef.current
      if (!video) return
      try {
        if (window.BarcodeDetector) {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
          })
          if (stopped) return
          video.srcObject = stream
          await video.play()
          const detector = new window.BarcodeDetector({ formats: EAN_FORMATS })
          timer = setInterval(() => {
            void detector
              .detect(video)
              .then((codes) => {
                if (codes[0]) found(codes[0].rawValue)
              })
              .catch(() => undefined)
          }, 300)
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser')
          const reader = new BrowserMultiFormatReader()
          zxingControls = await reader.decodeFromVideoDevice(undefined, video, (result) => {
            if (result) found(result.getText())
          })
        }
      } catch {
        if (!stopped) setCameraError(true)
      }
    }

    void start()
    return () => {
      stopped = true
      if (timer) clearInterval(timer)
      zxingControls?.stop()
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [onDetect])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg/95 p-4">
      <div className="flex items-center justify-between pb-2">
        <h2 className="font-semibold">Ler código de barras</h2>
        <button className="px-2 text-dim" onClick={onClose}>
          Fechar
        </button>
      </div>

      {cameraError ? (
        <p className="py-6 text-center text-sm text-dim">
          Sem acesso à câmara. Escreve o código à mão em baixo.
        </p>
      ) : (
        <video
          ref={videoRef}
          className="w-full flex-1 rounded-2xl border border-edge object-cover"
          muted
          playsInline
        />
      )}

      <div className="flex gap-2 pt-4">
        <input
          inputMode="numeric"
          placeholder="ou escreve o EAN"
          value={manual}
          onChange={(e) => setManual(e.target.value.replace(/\D/g, ''))}
          className="min-w-0 flex-1 rounded-xl border border-edge bg-card px-3 py-3 text-ink placeholder:text-dim focus:border-accent focus:outline-none"
        />
        <button
          disabled={manual.length < 8}
          onClick={() => onDetect(manual)}
          className="rounded-xl bg-accent px-4 py-3 font-semibold text-bg disabled:opacity-50"
        >
          OK
        </button>
      </div>
    </div>
  )
}
