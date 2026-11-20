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

  // sistema do visitante (só pra escolher o botão principal)
  var ua = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || ''
  var os = /win/i.test(ua) ? 'win' : /mac|iphone|ipad/i.test(ua) ? 'mac' : 'linux'

  // última release: versão no selo, links diretos e o botão principal do sistema do visitante (se a
  // release tiver o pacote dele; senão fica o do Linux)
  fetch('https://api.github.com/repos/chmenegatti/zeno/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) {
      return r.ok ? r.json() : null
    })
    .then(function (rel) {
      if (!rel || !rel.tag_name) return
      document.getElementById('release-text').textContent = 'Zeno ' + rel.tag_name + ' disponível'
      var assets = rel.assets || []
      var find = function (re) {
        return assets.find(function (a) { return re.test(a.name) })
      }
      var deb = find(/\.deb$/)
      var img = find(/\.AppImage$/)
      var rpm = find(/\.rpm$/)
      var win = find(/windows-setup\.exe$/)
      var mac = find(/macos-universal\.dmg$/)
      var setText = function (id, t) {
        var el = document.getElementById(id)
        if (el) el.textContent = t
      }
      var show = function (key, asset) {
        if (!asset) return
        document.querySelectorAll('[data-os="' + key + '"]').forEach(function (el) {
          el.hidden = false
        })
      }
      if (deb) {
        document.getElementById('dl-deb').href = deb.browser_download_url
        document.getElementById('dl-deb2').href = deb.browser_download_url
        setText('deb-name', deb.name)
      }
      if (img) {
        document.getElementById('dl-appimage').href = img.browser_download_url
        setText('ai-name', img.name)
        setText('ai-name2', img.name)
      }
      if (rpm) setText('rpm-name', rpm.name)
      if (win) setText('win-name', win.name)
      if (mac) setText('mac-name', mac.name)
      show('rpm', rpm)
      show('win', win)
      show('mac', mac)

      var main = document.getElementById('dl-deb')
      var alt = document.getElementById('dl-appimage')
      var sub = document.getElementById('dl-sub')
      var label = function (text, ext) {
        main.innerHTML = main.querySelector('svg').outerHTML + ' ' + text + ' <small>' + ext + '</small>'
      }
      if (os === 'win' && win) {
        label('Baixar para Windows', '.exe')
        main.href = win.browser_download_url
        document.getElementById('dl-deb2').href = win.browser_download_url
        var zip = find(/windows-portable\.zip$/)
        if (zip) {
          alt.textContent = 'Portátil (.zip)'
          alt.href = zip.browser_download_url
        } else alt.hidden = true
        sub.textContent = rel.tag_name + ' · Windows 10 e 11 (64 bits) · também para Linux e macOS'
      } else if (os === 'mac' && mac) {
        label('Baixar para macOS', '.dmg')
        main.href = mac.browser_download_url
        document.getElementById('dl-deb2').href = mac.browser_download_url
        alt.hidden = true
        sub.textContent = rel.tag_name + ' · Intel e Apple Silicon · também para Linux e Windows'
      } else {
        sub.textContent = rel.tag_name + ' · Ubuntu, Debian e derivados' + (rpm ? ' · Fedora (.rpm)' : '') + ' · qualquer distro com AppImage'
      }
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
