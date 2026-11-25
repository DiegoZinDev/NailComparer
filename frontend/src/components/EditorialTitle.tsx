import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface EditorialTitleProps {
  text: string;
  className?: string;
}

/**
 * Transitions.dev / React Bits inspired smooth blur-dissolve editorial title
 */
export const EditorialTitle: React.FC<EditorialTitleProps> = ({ text, className = '' }) => {
  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={text}
        initial={{ opacity: 0, y: 6, filter: 'blur(4px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
        className={className}
      >
        {text}
      </motion.span>
    </AnimatePresence>
  );
};
