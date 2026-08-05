import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

// Campo de contrasena con boton "mostrar/ocultar" (ojito): permite verificar
// que la contrasena se escribio bien (util para la clave del negocio en la
// nube). Envuelve un <input> y le pasa el resto de props (value, onChange,
// autoComplete, placeholder...). El TIPO lo controla el propio componente
// (text/password), asi que sobreescribe cualquier `type` que llegue.
export function PasswordInput({ className = '', ...props }) {
  const [show, setShow] = useState(false)
  return (
    <div className={`pass-field ${className}`.trim()}>
      <input {...props} type={show ? 'text' : 'password'} />
      <button
        type="button"
        className="pass-field__toggle"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        title={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      >
        {show ? <EyeOff size={18} strokeWidth={1.9} /> : <Eye size={18} strokeWidth={1.9} />}
      </button>
    </div>
  )
}
