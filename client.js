var textarea

document.addEventListener('DOMContentLoaded', function () {
  textarea = document.getElementById('textarea')
  textarea.addEventListener('input', onInput)
  var form = document.getElementById('form')
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
