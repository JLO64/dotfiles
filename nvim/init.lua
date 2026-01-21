-- bootstrap lazy.nvim, LazyVim and your plugins
require("config.lazy")

vim.api.nvim_create_user_command("CopyPath", function(context)
  local full_path = vim.fn.expand("%:p") -- Ensure to use absolute path here
  local file_path = nil

  if not context["args"] then
    local relative_path = vim.fn.fnamemodify(vim.fn.expand("%"), ":~:.")
    file_path = relative_path
  else
    if context["args"] == "nameonly" then
      file_path = vim.fn.fnamemodify(full_path, ":t")
    elseif context["args"] == "absolute" then
      file_path = full_path
    else
      local relative_path = vim.fn.fnamemodify(vim.fn.expand("%"), ":~:.")
      file_path = relative_path
    end
  end

  if type(file_path) ~= "string" then
    -- print an error
    vim.print("Failed to get file path")
    return
  end

  vim.fn.setreg("+", file_path)
  vim.print("Filepath copied to clipboard!")
end, {
  bang = false,
  nargs = "*", -- Allow zero or more arguments
  force = true,
  desc = "Copy current file path to clipboard",
  complete = function()
    return { "nameonly", "relative", "absolute" }
  end,
})

vim.api.nvim_create_user_command("CopyFunction", function()
  local ts_utils = require("nvim-treesitter.ts_utils")
  local parsers = require("nvim-treesitter.parsers")

  if not parsers.has_parser() then
    vim.print("No TreeSitter parser available for this filetype")
    return
  end

  local node = ts_utils.get_node_at_cursor()
  if not node then
    vim.print("No node found at cursor")
    return
  end

  -- Walk up the tree to find a function definition
  local function_node = node
  while function_node do
    local node_type = function_node:type()
    -- Debug: print the current node type
    -- vim.print("Checking node type: " .. node_type)

    if node_type == "function_definition" or node_type == "async_function_definition" then
      break
    end
    function_node = function_node:parent()
  end

  if not function_node then
    vim.print("Not inside a function")
    return
  end

  -- Get the function name - try multiple approaches
  local function_name = nil

  -- Method 1: Try to get name field
  for child in function_node:iter_children() do
    if child:type() == "identifier" then
      function_name = vim.treesitter.get_node_text(child, 0)
      break
    end
  end

  -- Method 2: If that didn't work, try getting the second child (common pattern)
  if not function_name then
    local children = {}
    for child in function_node:iter_children() do
      table.insert(children, child)
    end
    if #children >= 2 and children[2]:type() == "identifier" then
      function_name = vim.treesitter.get_node_text(children[2], 0)
    end
  end

  if not function_name then
    vim.print("Could not find function name")
    return
  end

  vim.fn.setreg("+", function_name)
  vim.print("Function name copied to clipboard: " .. function_name)
end, {
  bang = false,
  nargs = 0,
  force = true,
  desc = "Copy current function name to clipboard",
})

vim.api.nvim_create_user_command("FormatJSON", function()
  vim.cmd([[:%!jq .]])
end, {})
