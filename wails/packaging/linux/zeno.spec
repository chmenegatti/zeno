# .rpm da versão Go (Fedora e afins). Montado por rpm.sh a partir do binário pronto: sem compilar aqui.
Name:           zeno
Version:        %{zeno_version}
Release:        1
Summary:        Tab-less, local-first API client for REST, GraphQL, gRPC and WebSocket
License:        MIT
URL:            https://github.com/chmenegatti/zeno
Requires:       gtk3
Requires:       webkit2gtk4.1
Recommends:     xdg-utils
AutoReqProv:    no

%global debug_package %{nil}
%global source_date_epoch_from_changelog 0
%global __strip /bin/true

%description
Zeno keeps collections as YAML files you can commit to git, encrypts secrets
inside them with a key in the system keyring, and imports Insomnia, Postman
and OpenAPI. No account, no telemetry.

%install
install -Dm755 %{zeno_bin} %{buildroot}/opt/Zeno/zeno
install -d %{buildroot}%{_bindir}
ln -s ../../opt/Zeno/zeno %{buildroot}%{_bindir}/zeno
install -Dm644 %{zeno_pkg}/zeno.desktop %{buildroot}%{_datadir}/applications/zeno.desktop
install -Dm644 %{zeno_metainfo} %{buildroot}%{_datadir}/metainfo/com.cesarmenegatti.Zeno.metainfo.xml
for s in 16 24 32 48 64 128 256 512; do
  install -Dm644 %{zeno_icons}/${s}x${s}.png %{buildroot}%{_datadir}/icons/hicolor/${s}x${s}/apps/zeno.png
done

%files
/opt/Zeno
%{_bindir}/zeno
%{_datadir}/applications/zeno.desktop
%{_datadir}/metainfo/com.cesarmenegatti.Zeno.metainfo.xml
%{_datadir}/icons/hicolor/*/apps/zeno.png
