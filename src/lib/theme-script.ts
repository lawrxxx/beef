// server-safe theme constants and the pre-paint script (no react here: the root layout imports it)

export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_KEY = "beef:theme";
/** browser chrome / status bar colours: the --bg of each theme */
export const THEME_COLORS: Record<ResolvedTheme, string> = { light: "#F2EDE3", dark: "#14120F" };


/** runs in <head> before anything renders. keep it small and dependency-free. */
export const THEME_SCRIPT = `(function(){try{var p=localStorage.getItem(${JSON.stringify(THEME_KEY)});if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";r.dataset.theme=p;var c=d?${JSON.stringify(THEME_COLORS.dark)}:${JSON.stringify(THEME_COLORS.light)};if(p!=="system"){var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].setAttribute("content",c);}}catch(e){}})();`;

