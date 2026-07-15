vim.o.cmdheight = 0
vim.o.laststatus = 3

require("vim._core.ui2").enable({
  msg = {
    targets = "msg",
    msg = {
      timeout = 3000,
    },
  },
})
