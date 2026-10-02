// Built-in themes (CSS strings). Each overrides tokens for dark and/or light.

export interface BuiltinTheme {
  name: string
  modes: ('dark' | 'light')[]
  css: string
}

const nord = `
body.theme-dark {
  --color-base-00:#2e3440; --color-base-05:#303643; --color-base-10:#323846; --color-base-20:#3b4252; --color-base-25:#404859;
  --color-base-30:#434c5e; --color-base-35:#4c566a; --color-base-40:#5b6579; --color-base-50:#7b8394; --color-base-60:#9aa3b5;
  --color-base-70:#c0c8d6; --color-base-100:#eceff4;
  --code-keyword:#81a1c1; --code-string:#a3be8c; --code-number:#b48ead; --code-function:#88c0d0; --code-type:#8fbcbb;
  --code-property:#d8dee9; --code-operator:#81a1c1; --code-tag:#bf616a; --code-comment:#616e88;
}
body.theme-light {
  --color-base-00:#eceff4; --color-base-05:#e9edf2; --color-base-10:#e5e9f0; --color-base-20:#dfe4ec; --color-base-25:#d8dee9;
  --color-base-30:#cfd6e2; --color-base-35:#c3cbd9; --color-base-40:#a5aebf; --color-base-50:#8a93a5; --color-base-60:#606a7e;
  --color-base-70:#4c566a; --color-base-100:#2e3440;
  --code-keyword:#5e81ac; --code-string:#5f7d45; --code-number:#8a5f84; --code-function:#3b7d8c; --code-type:#4b7b7a;
}`

const dracula = `
body.theme-dark {
  --color-base-00:#282a36; --color-base-05:#2a2c39; --color-base-10:#2c2e3b; --color-base-20:#21222c; --color-base-25:#343746;
  --color-base-30:#3a3c4e; --color-base-35:#44475a; --color-base-40:#565a72; --color-base-50:#6272a4; --color-base-60:#8a93b8;
  --color-base-70:#bcc2dc; --color-base-100:#f8f8f2;
  --code-keyword:#ff79c6; --code-string:#f1fa8c; --code-number:#bd93f9; --code-function:#50fa7b; --code-type:#8be9fd;
  --code-property:#66d9ef; --code-operator:#ff79c6; --code-tag:#ff5555; --code-comment:#6272a4;
}`

const solarized = `
body.theme-dark {
  --color-base-00:#002b36; --color-base-05:#012e3a; --color-base-10:#03313d; --color-base-20:#073642; --color-base-25:#0a3d4a;
  --color-base-30:#0f4654; --color-base-35:#1b5260; --color-base-40:#36606b; --color-base-50:#586e75; --color-base-60:#839496;
  --color-base-70:#93a1a1; --color-base-100:#eee8d5;
  --code-keyword:#859900; --code-string:#2aa198; --code-number:#d33682; --code-function:#268bd2; --code-type:#b58900;
  --code-property:#6c71c4; --code-operator:#cb4b16; --code-tag:#dc322f; --code-comment:#586e75;
}
body.theme-light {
  --color-base-00:#fdf6e3; --color-base-05:#faf3df; --color-base-10:#f7f0dc; --color-base-20:#eee8d5; --color-base-25:#e6dfca;
  --color-base-30:#ddd6c1; --color-base-35:#d3cbb4; --color-base-40:#b9b29c; --color-base-50:#93a1a1; --color-base-60:#657b83;
  --color-base-70:#586e75; --color-base-100:#073642;
  --code-keyword:#859900; --code-string:#2aa198; --code-number:#d33682; --code-function:#268bd2; --code-type:#b58900;
}`

const gruvbox = `
body.theme-dark {
  --color-base-00:#282828; --color-base-05:#2a2a2a; --color-base-10:#2c2c2c; --color-base-20:#1d2021; --color-base-25:#32302f;
  --color-base-30:#3c3836; --color-base-35:#504945; --color-base-40:#665c54; --color-base-50:#7c6f64; --color-base-60:#a89984;
  --color-base-70:#d5c4a1; --color-base-100:#ebdbb2;
  --code-keyword:#fb4934; --code-string:#b8bb26; --code-number:#d3869b; --code-function:#fabd2f; --code-type:#8ec07c;
  --code-property:#83a598; --code-operator:#fe8019; --code-tag:#fb4934; --code-comment:#928374;
}
body.theme-light {
  --color-base-00:#fbf1c7; --color-base-05:#f9efc4; --color-base-10:#f6ebc0; --color-base-20:#f2e5bc; --color-base-25:#ebdbb2;
  --color-base-30:#e2d2a8; --color-base-35:#d5c4a1; --color-base-40:#bdae93; --color-base-50:#a89984; --color-base-60:#7c6f64;
  --color-base-70:#504945; --color-base-100:#282828;
  --code-keyword:#9d0006; --code-string:#79740e; --code-number:#8f3f71; --code-function:#b57614; --code-type:#427b58;
}`

const rosePine = `
body.theme-dark {
  --color-base-00:#191724; --color-base-05:#1c1a29; --color-base-10:#1f1d2e; --color-base-20:#1f1d2e; --color-base-25:#26233a;
  --color-base-30:#2a273f; --color-base-35:#393552; --color-base-40:#44415a; --color-base-50:#6e6a86; --color-base-60:#908caa;
  --color-base-70:#b9b5d0; --color-base-100:#e0def4;
  --code-keyword:#31748f; --code-string:#f6c177; --code-number:#ebbcba; --code-function:#ebbcba; --code-type:#9ccfd8;
  --code-property:#c4a7e7; --code-operator:#31748f; --code-tag:#eb6f92; --code-comment:#6e6a86;
}
body.theme-light {
  --color-base-00:#faf4ed; --color-base-05:#f8f1e9; --color-base-10:#fffaf3; --color-base-20:#f2e9e1; --color-base-25:#ece2d9;
  --color-base-30:#dfdad9; --color-base-35:#cecacd; --color-base-40:#b4afb6; --color-base-50:#9893a5; --color-base-60:#797593;
  --color-base-70:#575279; --color-base-100:#2a2643;
  --code-keyword:#286983; --code-string:#ea9d34; --code-number:#d7827e; --code-function:#d7827e; --code-type:#56949f;
}`

const midnight = `
body.theme-dark {
  --color-base-00:#0d1117; --color-base-05:#0f141b; --color-base-10:#11161d; --color-base-20:#161b22; --color-base-25:#1b2129;
  --color-base-30:#21262d; --color-base-35:#30363d; --color-base-40:#484f58; --color-base-50:#6e7681; --color-base-60:#8b949e;
  --color-base-70:#b1bac4; --color-base-100:#e6edf3;
  --code-keyword:#ff7b72; --code-string:#a5d6ff; --code-number:#79c0ff; --code-function:#d2a8ff; --code-type:#ffa657;
  --code-property:#79c0ff; --code-operator:#ff7b72; --code-tag:#7ee787; --code-comment:#8b949e;
}`

export const BUILTIN_THEMES: BuiltinTheme[] = [
  { name: 'Nord', modes: ['dark', 'light'], css: nord },
  { name: 'Dracula', modes: ['dark'], css: dracula },
  { name: 'Solarized', modes: ['dark', 'light'], css: solarized },
  { name: 'Gruvbox', modes: ['dark', 'light'], css: gruvbox },
  { name: 'Rosé Pine', modes: ['dark', 'light'], css: rosePine },
  { name: 'Midnight (GitHub)', modes: ['dark'], css: midnight }
]
