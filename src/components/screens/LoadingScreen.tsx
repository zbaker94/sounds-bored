export function LoadingScreen() {
  return (
    <div className="fixed inset-0 bg-black flex items-center justify-center z-50">
      <span className="font-deathletter text-white text-4xl tracking-widest animate-pulse">
        Loading
      </span>
    </div>
  );
}
