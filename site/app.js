// Tema claro/escuro, links de download da última versão e animação de entrada.

;(function () {
  var root = document.documentElement
  var btn = document.getElementById('theme')
  btn.addEventListener('click', function () {
    var next = root.dataset.theme === 'dark' ? 'light' : 'dark'
    root.dataset.theme = next
    try {
      localStorage.setItem('zeno-site-theme', next)
    } catch (e) {}
  })

  // última release: versão no selo e links diretos pro .deb e o AppImage
  fetch('https://api.github.com/repos/chmenegatti/zeno/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) {
      return r.ok ? r.json() : null
    })
    .then(function (rel) {
      if (!rel || !rel.tag_name) return
      document.getElementById('release-text').textContent = 'Zeno ' + rel.tag_name + ' disponível'
      var assets = rel.assets || []
      var deb = assets.find(function (a) { return /\.deb$/.test(a.name) })
      var img = assets.find(function (a) { return /\.AppImage$/.test(a.name) })
      if (deb) {
        document.getElementById('dl-deb').href = deb.browser_download_url
        document.getElementById('dl-deb2').href = deb.browser_download_url
        document.getElementById('deb-name').textContent = deb.name
      }
      if (img) {
        document.getElementById('dl-appimage').href = img.browser_download_url
        document.getElementById('ai-name').textContent = img.name
        document.getElementById('ai-name2').textContent = img.name
      }
      var sub = document.getElementById('dl-sub')
      sub.textContent = rel.tag_name + ' · Ubuntu, Debian e derivados · qualquer distro com AppImage'
    })
    .catch(function () {})

  // seções aparecem ao rolar
  var els = document.querySelectorAll('.card, .feature > *, .themes figure, .box, .head, .shot.wide')
  if (!('IntersectionObserver' in window)) return
  var io = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('in')
          io.unobserve(e.target)
        }
      })
    },
    { rootMargin: '0px 0px -8% 0px' }
  )
  els.forEach(function (el) {
    el.classList.add('reveal')
    io.observe(el)
  })
})()
