vim.diagnostic.config({
  virtual_text = true,
  signs = true,
  underline = true,
  update_in_insert = false,
  severity_sort = true,
})

local function format_with_ruff(bufnr)
  bufnr = bufnr or 0

  if #vim.lsp.get_clients({ bufnr = bufnr, name = "ruff" }) == 0 then
    vim.notify("Ruff is not attached to this buffer", vim.log.levels.WARN)
    return
  end

  vim.lsp.buf.format({
    bufnr = bufnr,
    name = "ruff",
    timeout_ms = 3000,
  })
end

vim.keymap.set("n", "<leader>cf", function()
  format_with_ruff(0)
end, { desc = "Format with Ruff" })

local format_group = vim.api.nvim_create_augroup("ruff_format_on_save", { clear = true })
local lsp_group = vim.api.nvim_create_augroup("lsp_setup", { clear = true })

vim.api.nvim_create_autocmd("LspAttach", {
  group = lsp_group,
  callback = function(event)
    local client = vim.lsp.get_client_by_id(event.data.client_id)
    if not client or client.name ~= "ruff" then
      return
    end

    vim.api.nvim_clear_autocmds({ group = format_group, buffer = event.buf })
    vim.api.nvim_create_autocmd("BufWritePre", {
      group = format_group,
      buffer = event.buf,
      callback = function()
        format_with_ruff(event.buf)
      end,
      desc = "Format Python with Ruff before saving",
    })
  end,
})

vim.api.nvim_create_autocmd("LspDetach", {
  group = lsp_group,
  callback = function(event)
    local client = vim.lsp.get_client_by_id(event.data.client_id)
    if client and client.name == "ruff" then
      vim.api.nvim_clear_autocmds({ group = format_group, buffer = event.buf })
    end
  end,
})

vim.lsp.enable("ruff")
