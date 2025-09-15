import React from "react";
import PdfPagePicker from "./PdfPagePicker";
import DocxToQuestions from "./DocxToQuestions";

interface Props {}

const page = (props: Props) => {
  return (
    <div className="px-2 sm:px-4 md:px-10 lg:px-20 xl:px-28 max-w-7xl mx-auto">
      <h2 className="text-4xl mt-15 text-semibold">PDF Editing</h2>
      <PdfPagePicker />
      <DocxToQuestions />
    </div>
  );
};

export default page;
