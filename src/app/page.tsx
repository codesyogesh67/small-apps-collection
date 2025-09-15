import Image from "next/image";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export default function Home() {
  return (
    <div className="px-2 sm:px-4 md:px-10 lg:px-20 xl:px-28 max-w-7xl mx-auto">
      <div className="flex flex-col justify-between text-center mt-20">
        <h2 className="text-5xl font-bold mb-15">Collection of Apps.</h2>
        <div className="flex flex-col gap-4">
          <Link href="/pdf-pages">
            <Button>Pdf Editor</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
