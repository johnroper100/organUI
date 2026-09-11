(() => {
    if (window.location.pathname.startsWith('/console/custom/')) return;
    const banner = document.createElement('div');
    banner.className = 'alert alert-warning m-3';
    banner.setAttribute('role', 'alert');
    banner.hidden = true;
    document.body.prepend(banner);
    async function refresh() {
        try {
            const response = await fetch('/api/left-on-alerts');
            if (!response.ok) return;
            const status = await response.json();
            banner.hidden = !(status.settings.enabled && status.settings.dashboard && status.active);
            banner.textContent = 'Organ left on without input. ' + (status.observation === 'unknown' || status.idleSeconds === null ? 'Awaiting current power and activity observations. ' : '') ;
            const link = document.createElement('a');
            link.href = '/console#probes'; link.textContent = 'Review monitoring alerts';
            banner.append(link);
        } catch { /* Retain an existing warning until power off is confirmed. */ }
    }
    refresh();
    setInterval(refresh, 15000);
})();
