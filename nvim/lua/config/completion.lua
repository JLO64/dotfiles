require("blink.cmp").setup({
  -- Use Blink only for command-line completion for now.
  enabled = function()
    return false
  end,
  fuzzy = {
    implementation = "lua",
  },
  cmdline = {
    keymap = {
      preset = "cmdline",
    },
    sources = { "cmdline", "buffer" },
    completion = {
      list = {
        selection = {
          preselect = false,
          auto_insert = false,
        },
      },
      menu = {
        auto_show = function()
          return vim.fn.getcmdtype() == ":"
        end,
      },
      ghost_text = {
        enabled = false,
      },
    },
  },
})
