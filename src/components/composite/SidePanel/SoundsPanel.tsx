const panelClass = "backdrop-blur-sm bg-black/50 rounded-lg";

export function SoundsPanel() {
  return (
    <div className="flex h-full min-h-0 gap-2 p-2">
      <div className="flex flex-col w-1/2 gap-2">
        <div className={`${panelClass} flex-1 border border-white`} />
        <div className={`${panelClass} flex-1 border border-white`} />
      </div>
      <div className={`${panelClass} w-1/2 border border-white`} />
    </div>
  );
}
