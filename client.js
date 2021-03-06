// Set beforeunload event listeners to prevent loss of unsaved work.

let textarea

document.addEventListener('DOMContentLoaded', function () {
  textarea = document.getElementById('textarea')
  textarea.addEventListener('input', onInput)
  const form = document.getElementById('form')
  form.addEventListener('submit', function () {
    window.removeEventListener('beforeunload', onBeforeUnload)
  })
})

function onInput () {
  window.addEventListener('beforeunload', onBeforeUnload)
  textarea.removeEventListener('input', onInput)
}

function onBeforeUnload (event) {
  event.preventDefault()
  event.returnValue = ''
}
