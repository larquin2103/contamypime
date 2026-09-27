// FALSO de 'firebase/auth' SOLO para pruebas: una sesion abierta del negocio de
// prueba, para que doPush no salga por 'no-auth'.
export const getAuth = () => ({ currentUser: { uid: 'neg-prueba' } })
