import { useEffect, useMemo, useRef, useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist'
import './App.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const INITIAL_RULES = [
  { id: 1, from: '#ff6b6b', to: '#4ade80', tolerance: 32 },
  { id: 2, from: '#38bdf8', to: '#f59e0b', tolerance: 28 },
]

function hexToRgb(value) {
  const clean = value.replace('#', '')
  const numeric = Number.parseInt(clean, 16)

  return {
    r: (numeric >> 16) & 255,
    g: (numeric >> 8) & 255,
    b: numeric & 255,
  }
}

function colorDistance(a, b) {
  const redDistance = a.r - b.r
  const greenDistance = a.g - b.g
  const blueDistance = a.b - b.b

  return Math.sqrt((redDistance * redDistance + greenDistance * greenDistance + blueDistance * blueDistance) / 3)
}

function applyColorRules(imageData, rules) {
  const source = new Uint8ClampedArray(imageData.data)

  for (let offset = 0; offset < source.length; offset += 4) {
    const alpha = source[offset + 3]
    if (alpha === 0) {
      continue
    }

    const original = {
      r: source[offset],
      g: source[offset + 1],
      b: source[offset + 2],
    }

    let bestRule = null
    let bestDistance = Number.POSITIVE_INFINITY

    for (const rule of rules) {
      const sourceColor = hexToRgb(rule.from)
      const distance = colorDistance(original, sourceColor)

      if (distance <= rule.tolerance && distance < bestDistance) {
        bestRule = rule
        bestDistance = distance
      }
    }

    if (!bestRule) continue

    const targetColor = hexToRgb(bestRule.to)
    const tolerance = Math.max(1, bestRule.tolerance)
    const mix = 1 - bestDistance / tolerance
    const blend = Math.max(0, Math.min(1, mix))
    const effectiveBlend = Math.min(1, 0.35 + blend * 0.75)

    source[offset] = Math.round(original.r + (targetColor.r - original.r) * effectiveBlend)
    source[offset + 1] = Math.round(original.g + (targetColor.g - original.g) * effectiveBlend)
    source[offset + 2] = Math.round(original.b + (targetColor.b - original.b) * effectiveBlend)
  }

  return new ImageData(source, imageData.width, imageData.height)
}

function App() {
  const [pdfFile, setPdfFile] = useState(null)
  const [rules, setRules] = useState(INITIAL_RULES)
  const [previewReady, setPreviewReady] = useState(false)
  const [pageCount, setPageCount] = useState(0)
  const [status, setStatus] = useState('PDF を選択すると、最初のページのプレビューと置換結果を確認できます。')
  const [isRendering, setIsRendering] = useState(false)
  const [isExporting, setIsExporting] = useState(false)

  const originalCanvasRef = useRef(null)
  const recoloredCanvasRef = useRef(null)

  const pdfPreviewUrl = useMemo(() => {
    if (!pdfFile) return ''
    return URL.createObjectURL(pdfFile)
  }, [pdfFile])

  useEffect(() => {
    return () => {
      if (pdfPreviewUrl) {
        URL.revokeObjectURL(pdfPreviewUrl)
      }
    }
  }, [pdfPreviewUrl])

  const renderPreview = async () => {
    if (!pdfFile) return

    setIsRendering(true)
    setStatus('プレビューを生成中です…')

    try {
      const arrayBuffer = await pdfFile.arrayBuffer()
      const document = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      const page = await document.getPage(1)
      const viewport = page.getViewport({ scale: 1.8 })

      const originalCanvas = originalCanvasRef.current
      const recoloredCanvas = recoloredCanvasRef.current

      if (!originalCanvas || !recoloredCanvas) {
        setStatus('プレビュー用の canvas が初期化されていません。もう一度お試しください。')
        return
      }

      const originalContext = originalCanvas.getContext('2d', { willReadFrequently: true })
      const recoloredContext = recoloredCanvas.getContext('2d', { willReadFrequently: true })

      originalCanvas.width = Math.ceil(viewport.width)
      originalCanvas.height = Math.ceil(viewport.height)
      recoloredCanvas.width = Math.ceil(viewport.width)
      recoloredCanvas.height = Math.ceil(viewport.height)

      await page.render({
        canvasContext: originalContext,
        viewport,
      }).promise

      const imageData = originalContext.getImageData(0, 0, originalCanvas.width, originalCanvas.height)
      const recoloredImageData = applyColorRules(imageData, rules)

      recoloredContext.putImageData(recoloredImageData, 0, 0)
      setPageCount(document.numPages)
      setPreviewReady(true)
      setStatus('プレビューを更新しました。')
    } catch (error) {
      setPreviewReady(false)
      setStatus('PDF のプレビュー生成に失敗しました。')
      console.error(error)
    } finally {
      setIsRendering(false)
    }
  }

  useEffect(() => {
    renderPreview()
  }, [pdfFile, rules])

  const updateRule = (index, key, value) => {
    setRules((currentRules) =>
      currentRules.map((rule, ruleIndex) =>
        ruleIndex === index
          ? {
              ...rule,
              [key]: key === 'tolerance' ? Number(value) : value,
            }
          : rule,
      ),
    )
  }

  const addRule = () => {
    setRules((current) => [
      ...current,
      {
        id: Date.now(),
        from: '#8b5cf6',
        to: '#f472b6',
        tolerance: 24,
      },
    ])
  }

  const removeRule = (index) => {
    setRules((current) => current.filter((_, ruleIndex) => ruleIndex !== index))
  }

  const exportRecoloredPdf = async () => {
    if (!pdfFile) return

    setIsExporting(true)
    setStatus('色置換済み PDF を生成中です…')

    try {
      const arrayBuffer = await pdfFile.arrayBuffer()
      const sourceDocument = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      const targetDocument = await PDFDocument.create()

      const EXPORT_SCALE = 2.4

      for (let pageNumber = 1; pageNumber <= sourceDocument.numPages; pageNumber += 1) {
        const page = await sourceDocument.getPage(pageNumber)
        const viewport = page.getViewport({ scale: EXPORT_SCALE })

        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)

        const context = canvas.getContext('2d', { willReadFrequently: true })
        await page.render({ canvasContext: context, viewport }).promise

        const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
        const recoloredImageData = applyColorRules(imageData, rules)
        context.putImageData(recoloredImageData, 0, 0)

        const pngDataUrl = canvas.toDataURL('image/png', 1.0)
        const pngBuffer = await fetch(pngDataUrl).then((response) => response.arrayBuffer())
        const image = await targetDocument.embedPng(new Uint8Array(pngBuffer))

        const outputPage = targetDocument.addPage([image.width, image.height])
        outputPage.drawImage(image, {
          x: 0,
          y: 0,
          width: image.width,
          height: image.height,
        })
      }

      const pdfBytes = await targetDocument.save()
      const blob = new Blob([pdfBytes], { type: 'application/pdf' })
      const downloadUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = `recolored-${pdfFile.name.replace(/\.pdf$/i, '')}.pdf`
      link.click()
      URL.revokeObjectURL(downloadUrl)

      setStatus('色置換済み PDF を出力しました。')
    } catch (error) {
      console.error(error)
      setStatus('PDF の出力に失敗しました。サイズの大きい PDF は時間がかかることがあります。')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">PDF Color Replacer</p>
          <h1>PDF色置換ツール</h1>
          <p className="lede">
            選択したPDFから色ルールを作成し、近い色を対応する置換色へ反映したプレビューを確認できます。
          </p>
        </div>
      </section>

      <section className="workspace-grid">
        <article className="panel controls-panel">
          <header className="panel-header">
            <div>
              <p className="panel-label">1. PDF を読み込む</p>
              <h2>入力 PDF</h2>
            </div>
            <button type="button" className="ghost-button" onClick={addRule}>
              ルールを追加
            </button>
          </header>

          <label className="upload-card" htmlFor="pdf-input">
            <strong>{pdfFile ? pdfFile.name : 'PDF ファイルを選択'}</strong>
            <span>クリックして PDF を読み込んでください</span>
          </label>
          <input id="pdf-input" type="file" accept="application/pdf" onChange={(event) => {
            const file = event.target.files?.[0] ?? null
            setPdfFile(file)
            setPreviewReady(false)
            if (file) {
              setStatus(`${file.name} を読み込みました。色ルールを調整してプレビューを確認できます。`)
            }
          }} />


          <div className="rules-list">
            {rules.map((rule, index) => (
              <article className="rule-card" key={rule.id}>
                <div className="rule-header">
                  <h3>ルール {index + 1}</h3>
                  {rules.length > 1 && (
                    <button type="button" style={{ color: '#5262da' }} className="text-button" onClick={() => removeRule(index)}>
                      削除
                    </button>
                  )}
                </div>
                <div className="field-grid">
                  <label>
                    <span>置換前</span>
                    <input
                      type="color"
                      value={rule.from}
                      onChange={(event) => updateRule(index, 'from', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>置換後</span>
                    <input
                      type="color"
                      value={rule.to}
                      onChange={(event) => updateRule(index, 'to', event.target.value)}
                    />
                  </label>
                  <label className="tolerance-field">
                    <span>近色許容値</span>
                    <strong>{rule.tolerance}</strong>
                    <input
                      type="range"
                      min="0"
                      max="255"
                      value={rule.tolerance}
                      onChange={(event) => updateRule(index, 'tolerance', event.target.value)}
                    />
                  </label>
                </div>
              </article>
            ))}
          </div>
        </article>

        <article className="panel preview-panel">
          <header className="panel-header">
            <div>
              <p className="panel-label">2. プレビュー</p>
              <h2>置換結果</h2>
            </div>
            <button
              type="button"
              className="primary-button"
              onClick={exportRecoloredPdf}
              disabled={!pdfFile || isExporting}
            >
              {isExporting ? '出力中…' : 'PDF を出力'}
            </button>
          </header>


          <div className="preview-grid">
            <section className="preview-card">
              <h3>元の PDF</h3>
              {pdfFile ? (
                <canvas ref={originalCanvasRef} className="preview-canvas" />
              ) : (
                <div className="empty-preview">PDF を選択すると最初のページが表示されます</div>
              )}
            </section>
            <section className="preview-card">
              <h3>置換後プレビュー</h3>
              {pdfFile ? (
                <canvas ref={recoloredCanvasRef} className="preview-canvas" />
              ) : (
                <div className="empty-preview">色ルールに合わせて結果を反映します</div>
              )}
            </section>
          </div>
          
          <div className="status-box">{status}</div>

          <div className="meta-row">
            <span>選択中: {pdfFile?.name ?? 'なし'}</span>
            <span>ページ数: {pageCount || 0}</span>
            <span>ルール数: {rules.length}</span>
            <span>{isRendering ? 'プレビュー生成中' : '準備完了'}</span>
          </div>

        
        </article>
      </section>
    </main>
  )
}

export default App
