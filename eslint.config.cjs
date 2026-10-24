const fs = require('node:fs')
const path = require('node:path')

const expo = require('@infinitetoken/eslint-config/expo')

// The pack's layering (CLAUDE.md, "Pack structure"): the shell and shared code never import a game,
// and a game never imports another game, so any game can leave or join the pack on its own.
const games = fs
  .readdirSync(path.join(path.dirname(require.resolve('./package.json')), 'src/games'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)

const noGameImports = (allowed) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['@/games/*', ...(allowed ? [`!@/games/${allowed}`, `!@/games/${allowed}/**`] : [])],
          message: allowed ? 'A game never imports another game. Move code two games share into src/shared.' : 'The shell and shared code never import a game. A game hands the shell what it needs through its GameDefinition (src/pack.ts).'
        }
      ]
    }
  ]
})

module.exports = [...expo, { files: ['src/shell/**', 'src/shared/**'], rules: noGameImports(null) }, ...games.map((id) => ({ files: [`src/games/${id}/**`], rules: noGameImports(id) }))]
