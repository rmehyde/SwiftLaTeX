mergeInto(LibraryManager.library, {
  // kpse_find_file_js(nameptr, format, mustexist) -> char*
  kpse_find_file_js__sig: "iiii",
  kpse_find_file_js: function (nameptr, format, mustexist) {
    return Asyncify.handleAsync(async () => {
      const ptr = await kpse_find_file_impl(nameptr, format, mustexist);
      return ptr | 0;
    });
  },

  // fontconfig_search_font_js(nameString, varString) -> char*;
  fontconfig_search_font_js__sig: "iii",
  fontconfig_search_font_js: function(nameptr, varptr) {
    return Asyncify.handleAsync(async() => {
      const ptr = await fontconfig_search_font_impl(nameptr, varptr);
      return ptr | 0;
    })

  }
});
