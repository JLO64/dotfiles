vim.api.nvim_create_user_command("CopyPath", function(context)
  local full_path = vim.fn.expand("%:p")
  local file_path

  if context.args == "nameonly" then
    file_path = vim.fn.fnamemodify(full_path, ":t")
  elseif context.args == "absolute" then
    file_path = full_path
  else
    file_path = vim.fn.fnamemodify(vim.fn.expand("%"), ":~:.")
  end

  vim.fn.setreg("+", file_path)
  vim.print("Filepath copied to clipboard!")
end, {
  nargs = "*",
  desc = "Copy the current file path",
  complete = function()
    return { "nameonly", "relative", "absolute" }
  end,
})

vim.api.nvim_create_user_command("CopyFunction", function()
  local parser_ok, parser = pcall(vim.treesitter.get_parser, 0)
  if not parser_ok or not parser then
    vim.print("No Tree-sitter parser available for this filetype")
    return
  end

  local parse_ok = pcall(function()
    parser:parse()
  end)
  if not parse_ok then
    vim.print("Failed to parse the current buffer")
    return
  end

  local node = vim.treesitter.get_node()
  if not node then
    vim.print("No node found at cursor")
    return
  end

  local function_node = node
  while function_node do
    local node_type = function_node:type()
    if node_type == "function_definition" or node_type == "async_function_definition" then
      break
    end
    function_node = function_node:parent()
  end

  if not function_node then
    vim.print("Not inside a function")
    return
  end

  local name_node = function_node:field("name")[1]
  local function_name = name_node and vim.treesitter.get_node_text(name_node, 0) or nil

  if not function_name then
    for child in function_node:iter_children() do
      if child:type() == "identifier" then
        function_name = vim.treesitter.get_node_text(child, 0)
        break
      end
    end
  end

  if not function_name then
    vim.print("Could not find function name")
    return
  end

  vim.fn.setreg("+", function_name)
  vim.print("Function name copied to clipboard: " .. function_name)
end, {
  desc = "Copy the enclosing function name",
})

vim.api.nvim_create_user_command("FormatJSON", function()
  vim.cmd([[:%!jq .]])
end, {
  desc = "Format the current buffer with jq",
})
