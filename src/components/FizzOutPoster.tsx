import React from 'react';

interface FizzOutPosterProps {
  className?: string;
  onClick?: () => void;
  titleText?: string;
  taglineText?: string;
  titleCharCount?: number;
  taglineCharCount?: number;
  titleProgress?: number;
  taglineProgress?: number;
  showTitleCursor?: boolean;
  showTaglineCursor?: boolean;
}

const FULL_TITLE = 'FIZZ OUT';
const FULL_TAGLINE = 'EVERY TOPIC IS A BATTLE. EVERY ARGUMENT IS A WEAPON.';

const getCharOpacity = (progress: number, index: number, total: number, fadeRatio: number) => {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const start = total > 1 ? (index * (1 - fadeRatio)) / (total - 1) : 0;
  if (progress <= start) return 0;
  if (progress >= start + fadeRatio) return 1;
  const t = (progress - start) / fadeRatio;
  return t * t * (3 - 2 * t);
};

export const FizzOutPoster: React.FC<FizzOutPosterProps> = ({
  className = '',
  onClick,
  titleText = FULL_TITLE,
  taglineText = FULL_TAGLINE,
  titleCharCount,
  taglineCharCount,
  titleProgress,
  taglineProgress,
}) => {
  return (
    <div
      onClick={onClick}
      className={`relative select-none aspect-square w-full max-w-[620px] mx-auto bg-black flex items-center justify-center ${className}`}
    >
      <svg
        viewBox="0 0 1000 1000"
        className="w-full h-full block"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="FIZZ OUT: Every Topic Is a Battle. Every Argument Is a Weapon"
      >
        {/* Pure Deep Black Canvas */}
        <rect width="1000" height="1000" fill="#000000" />

        {/* Main FO Monogram (Slightly smaller, centered, no glow/shadow effects) */}
        <g id="fo-monogram" transform="translate(500, 385) scale(0.84)">
          {/* Orange "O" (Geometric Rounded Stadium, Slanted Italic, Behind F) */}
          <g transform="translate(68, 65) skewX(-17)">
            <rect
              x="-105"
              y="-155"
              width="210"
              height="310"
              rx="95"
              ry="95"
              fill="#000000"
              stroke="#FA5A00"
              strokeWidth="32"
              strokeLinejoin="round"
            />
          </g>

          {/* White "F" (Sharp Angular Esports Letterform, Slanted Italic, In Front) */}
          <g transform="translate(-85, -60) skewX(-17)">
            <path
              d="M -110, -170
                 L 130, -170
                 L 130, -100
                 L -35, -100
                 L -35, -30
                 L 75, -30
                 L 75, 35
                 L -35, 35
                 L -35, 175
                 L -110, 175
                 Z"
              fill="#000000"
              stroke="#FFFFFF"
              strokeWidth="30"
              strokeLinejoin="miter"
              strokeMiterlimit="4"
            />
          </g>
        </g>

        {/* Title Text: FIZZ OUT (Using exact same Doctor Glitch font/style as Page 2) */}
        <g transform="translate(500, 730)">
          <text
            x="0"
            y="0"
            textAnchor="middle"
            fontFamily="'Doctor Glitch', 'Rubik Glitch', sans-serif"
            fontSize="82"
            letterSpacing="6"
          >
            {titleProgress !== undefined
              ? FULL_TITLE.split('').map((char, index) => {
                  const color = index < 5 ? '#FFFFFF' : '#FA5A00';
                  const opacity = getCharOpacity(titleProgress, index, FULL_TITLE.length, 0.16);
                  return (
                    <tspan
                      key={index}
                      fill={color}
                      opacity={Number(opacity.toFixed(3))}
                    >
                      {char}
                    </tspan>
                  );
                })
              : titleCharCount !== undefined
              ? FULL_TITLE.split('').map((char, index) => {
                  const color = index < 5 ? '#FFFFFF' : '#FA5A00';
                  return (
                    <tspan
                      key={index}
                      fill={index < titleCharCount ? color : 'transparent'}
                      opacity={index < titleCharCount ? 1 : 0}
                    >
                      {char}
                    </tspan>
                  );
                })
              : (
                  <>
                    <tspan fill="#FFFFFF">FIZZ </tspan>
                    <tspan fill="#FA5A00">OUT</tspan>
                  </>
                )}
          </text>
        </g>

        {/* Tagline: EVERY TOPIC IS A BATTLE. EVERY ARGUMENT IS A WEAPON. */}
        <g transform="translate(500, 792)">
          <text
            x="0"
            y="0"
            textAnchor="middle"
            fill="#FA5A00"
            fontFamily="'Outfit', 'Montserrat', system-ui, sans-serif"
            fontWeight="800"
            fontSize="28"
            letterSpacing="0.7"
          >
            {taglineProgress !== undefined
              ? FULL_TAGLINE.split('').map((char, index) => {
                  const opacity = getCharOpacity(taglineProgress, index, FULL_TAGLINE.length, 0.05);
                  return (
                    <tspan
                      key={index}
                      fill="#FA5A00"
                      opacity={Number(opacity.toFixed(3))}
                    >
                      {char}
                    </tspan>
                  );
                })
              : taglineCharCount !== undefined
              ? FULL_TAGLINE.split('').map((char, index) => (
                  <tspan
                    key={index}
                    fill={index < taglineCharCount ? '#FA5A00' : 'transparent'}
                    opacity={index < taglineCharCount ? 1 : 0}
                  >
                    {char}
                  </tspan>
                ))
              : taglineText}
          </text>
        </g>
      </svg>
    </div>
  );
};
