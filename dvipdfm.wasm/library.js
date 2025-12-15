mergeInto(LibraryManager.library, {
  kpse_find_file_js: function (nameptr, format, mustexist) {
    const ret = kpse_find_file_impl(nameptr, format, mustexist);
    console.log("[KPSE_RET]", ret, "then?", ret && typeof ret.then === "function");
    return Asyncify.handleAsync(() => Promise.resolve(ret).then(ptr => ptr | 0));
  }
});
