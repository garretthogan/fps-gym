import './style.css'
import { initGame } from './game.js'

const app = document.querySelector('#app')
app.innerHTML = '<div id="hint">Click or press A (gamepad) to play — WASD / left stick move · Space / A jump · C / B crouch · Right stick look · Wall run: jump at wall, Space to wall jump</div>'
initGame(app)

document.addEventListener('pointerlockchange', () => {
  const hint = document.getElementById('hint')
  if (hint) hint.style.display = document.pointerLockElement ? 'none' : 'block'
})
