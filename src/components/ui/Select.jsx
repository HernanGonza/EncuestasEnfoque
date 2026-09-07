import { useEffect, useRef, useState, Children } from 'react'

// Reemplazo de <select> nativo para los reportes (Sección 8 del plan).
//
// Por qué existe: un <select> nativo se abre/cierra con el patrón
// "mousedown abre, mouseup sobre la opción bajo el cursor selecciona" (como
// un menú contextual). Con listas largas (preguntas, candidatos, encuestas a
// comparar, etc.) eso rompe la interacción: si el mouse ya está sobre la
// zona donde el navegador decide abrir la lista, el mouseup del mismo click
// que abrió el menú cae encima de una opción y la selecciona sola — hay que
// mantener el botón apretado y recién soltar sobre la opción correcta para
// que ande. Acá el "abrir" y el "elegir" son dos clicks (mousedown+mouseup)
// completamente separados, así que ese comportamiento no puede pasar.
//
// API compatible con <select> para que reemplazarlo sea un cambio de
// una línea en cada lugar: value/onChange (onChange recibe un objeto con
// target.value, igual que el evento nativo) + <option value=".."> como
// children (soporta disabled por opción).
export function Select({ value, onChange, children, disabled, style, placeholder }) {
  const [open, setOpen] = useState(false)
  const [dropUp, setDropUp] = useState(false)
  const wrapRef = useRef(null)

  const opciones = Children.toArray(children)
    .filter(c => c?.props && 'value' in c.props)
    .map(c => ({ value: c.props.value, label: c.props.children, disabled: !!c.props.disabled }))

  const actual = opciones.find(o => String(o.value) === String(value ?? ''))

  useEffect(() => {
    if (!open) return
    function onFuera(e) { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    function onTecla(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onFuera)
    document.addEventListener('keydown', onTecla)
    return () => {
      document.removeEventListener('mousedown', onFuera)
      document.removeEventListener('keydown', onTecla)
    }
  }, [open])

  function alternar() {
    if (disabled) return
    if (!open && wrapRef.current) {
      const rect = wrapRef.current.getBoundingClientRect()
      setDropUp(window.innerHeight - rect.bottom < 260 && rect.top > 260)
    }
    setOpen(o => !o)
  }

  function elegir(op) {
    if (op.disabled) return
    setOpen(false)
    onChange?.({ target: { value: op.value } })
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button type="button" disabled={disabled} onClick={alternar} style={{
        ...style, width: style?.width ?? '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 8, textAlign: 'left', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.55 : 1,
      }}>
        {/* Antes truncaba con ellipsis y el texto de preguntas largas quedaba
            cortado; ahora se permite bajar de línea para verse completo.
            flex:1 + minWidth:0 son necesarios para que el wrap funcione dentro
            del botón flex (si no, el texto lo empuja en vez de bajar de línea). */}
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.3 }}>
          {actual ? actual.label : (placeholder ?? '')}
        </span>
        <span style={{ fontSize: 10, color: 'var(--ink3)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', left: 0, right: 0, [dropUp ? 'bottom' : 'top']: 'calc(100% + 4px)',
          background: 'var(--paper)', border: '1.5px solid var(--border2)', borderRadius: 'var(--r)',
          boxShadow: '0 8px 24px rgba(0,0,0,.18)', maxHeight: 260, overflowY: 'auto', zIndex: 2000,
        }}>
          {opciones.map((op, i) => {
            const seleccionada = String(op.value) === String(value ?? '')
            return (
              <div key={i} onClick={() => elegir(op)} onMouseDown={e => e.preventDefault()}
                style={{
                  padding: '8px 12px', fontSize: style?.fontSize ?? 13, fontFamily: 'DM Sans',
                  cursor: op.disabled ? 'default' : 'pointer', color: op.disabled ? 'var(--ink4)' : 'var(--ink)',
                  background: seleccionada ? 'var(--accent-light)' : 'transparent',
                  fontWeight: seleccionada ? 700 : 400,
                  // whiteSpace normal + wordBreak: antes con nowrap el texto de
                  // preguntas largas quedaba cortado; ahora baja de línea completo.
                  whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.35,
                }}
                onMouseEnter={e => { if (!op.disabled) e.currentTarget.style.background = 'var(--surface)' }}
                onMouseLeave={e => { e.currentTarget.style.background = seleccionada ? 'var(--accent-light)' : 'transparent' }}
              >{op.label}</div>
            )
          })}
        </div>
      )}
    </div>
  )
}
