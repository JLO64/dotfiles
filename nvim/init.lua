vim.g.mapleader = " "
vim.g.maplocalleader = " "
vim.opt.clipboard = "unnamedplus"

vim.pack.add({
  {
    src = "https://github.com/rose-pine/neovim",
    name = "rose-pine",
  },
  "https://github.com/folke/flash.nvim",
  {
    src = "https://github.com/saghen/blink.cmp",
    version = vim.version.range("1.*"),
  },
  "https://github.com/ibhagwan/fzf-lua",
})

vim.cmd.colorscheme("rose-pine-moon")

require("config.commands")
require("config.completion")
require("config.editing")
require("config.lsp")
require("config.picker")
require("config.ui")

require("flash").setup({})

vim.keymap.set({ "n", "x", "o" }, "s", function()
  require("flash").jump()
end, { desc = "Flash" })
