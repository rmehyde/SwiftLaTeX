mergeInto(LibraryManager.library, {
  // kpse_find_file_js(nameptr, format, mustexist) -> char*
  kpse_find_file_js__sig: "iiii",
  kpse_find_file_js: function (nameptr, format, mustexist) {
    return Asyncify.handleAsync(async () => {
      const ptr = await kpse_find_file_impl(nameptr, format, mustexist);
      return ptr | 0;
    });
  },
});
