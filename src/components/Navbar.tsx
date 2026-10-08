import Link from "next/link";

const Navbar = () => {
  return (
    <nav className="bg-slate-800 border-b border-slate-700 shadow-lg">
      <div className="max-w-7xl mx-auto px-4">
        <div className="h-16 flex justify-between">
          <div className="flex items-center">
            <Link href="/" className="text-primary text-xl font-bold">
              EventPlanner
            </Link>
          </div>

          <div className="hidden md:flex items-center space-x-4">
            <Link
              href="/events"
              className="text-foreground hover:text-primary px-3 py-2 rounded-md text-sm font-medium transition-colors"
            >
              Events
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
