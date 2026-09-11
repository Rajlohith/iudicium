// Shared across all pages.
// 1. Runs lucide.createIcons() so sidebar icons always render.
// 2. Desktop (>900px): sidebar is always collapsed on load — hover-to-expand
//    is handled purely by CSS (.sidebar--collapsed:hover rules in styles.css).
// 3. Mobile (<=900px): sidebar is hidden off-canvas by default. A hamburger
//    button in the topbar toggles it open as an overlay panel, with a
//    backdrop that closes it on tap.
(function () {

    var MOBILE_QUERY = "(max-width: 900px)";

    // Initialise icons immediately so the brand logo renders.
    if (window.lucide) lucide.createIcons();

    function isMobile() {
        return window.matchMedia(MOBILE_QUERY).matches;
    }

    document.addEventListener("DOMContentLoaded", function () {
        // Re-run after DOM is ready in case icons were added late.
        if (window.lucide) lucide.createIcons();

        var sidebar = document.getElementById("sidebar");
        var overlay = document.getElementById("sidebarOverlay");
        var menuBtn = document.getElementById("mobileMenuBtn");

        // Always start collapsed so the CSS hover-expand kicks in on desktop.
        // (Harmless on mobile — the mobile styles override sidebar width.)
        if (sidebar) {
            sidebar.classList.add("sidebar--collapsed");
        }

        function openMobileMenu() {
            if (!sidebar) return;
            sidebar.classList.add("sidebar--mobile-open");
            if (overlay) overlay.classList.add("open");
            if (menuBtn) menuBtn.setAttribute("aria-expanded", "true");
            document.body.classList.add("no-scroll");
        }

        function closeMobileMenu() {
            if (!sidebar) return;
            sidebar.classList.remove("sidebar--mobile-open");
            if (overlay) overlay.classList.remove("open");
            if (menuBtn) menuBtn.setAttribute("aria-expanded", "false");
            document.body.classList.remove("no-scroll");
        }

        if (menuBtn) {
            menuBtn.addEventListener("click", function () {
                if (sidebar && sidebar.classList.contains("sidebar--mobile-open")) {
                    closeMobileMenu();
                } else {
                    openMobileMenu();
                }
            });
        }

        if (overlay) {
            overlay.addEventListener("click", closeMobileMenu);
        }

        // Tapping a nav link on mobile should close the panel (in case the
        // navigation is intercepted/async elsewhere); harmless on normal
        // links since the page unloads anyway.
        if (sidebar) {
            sidebar.querySelectorAll(".sidebar__link").forEach(function (link) {
                link.addEventListener("click", function () {
                    if (isMobile()) closeMobileMenu();
                });
            });
        }

        // Close the mobile panel automatically if the viewport is resized
        // back up to desktop width.
        window.addEventListener("resize", function () {
            if (!isMobile()) closeMobileMenu();
        });

        // Escape key closes the mobile panel.
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape") closeMobileMenu();
        });
    });

})();
