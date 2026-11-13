const paths = {
  book: "M3 4.5c3.5-.9 6.4-.3 9 1.6 2.6-1.9 5.5-2.5 9-1.6v14c-3.5-.9-6.4-.3-9 1.6-2.6-1.9-5.5-2.5-9-1.6z M12 6v14",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  close: "m6 6 12 12 M18 6 6 18",
  edit: "m15 5 4 4 M4 20l4.5-1 12-12a2.8 2.8 0 0 0-4-4l-12 12z",
  file: "M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h5",
  more: "M5 12h.1 M12 12h.1 M19 12h.1",
  account: "M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21a8 8 0 0 1 16 0",
  attach: "m8 13 7-7a3 3 0 0 1 4 4L9 20a5 5 0 0 1-7-7L13 2",
};

export function WikiIcon({ name }: { name: keyof typeof paths }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={name === "more" ? 3.4 : 1.7} strokeLinecap="round" strokeLinejoin="round" className="wiki-icon">
    <path d={paths[name]} />
  </svg>;
}
