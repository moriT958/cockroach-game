import { Controller } from '@/controller/Controller'
import { Screen } from '@/screen/Screen'

// / は PC の共有画面、/play はスマホのコントローラー。
export default function App() {
  return window.location.pathname.startsWith('/play') ? <Controller /> : <Screen />
}
