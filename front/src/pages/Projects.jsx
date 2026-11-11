import ProjectCard from "./components/ProjectCard";

const Projects = () => {
  return (
    <div className="projects">
      <ProjectCard
        name="Drakarys"
        description="AI Competition Platform"
        imageUrl="/drakarys-preview.svg"
        videoUrl="/drakarys-promo-hd.mp4"
        posterUrl="/drakarys-promo-poster.jpg"
        link="/projects/drakarys"
      />
    </div>
  );
};

export default Projects;
