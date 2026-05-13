package accuratemini

type Worker interface {
	Do() error
}

type Impl struct{}

func Run() error {
	return Entry(Impl{})
}

func Entry(worker Worker) error {
	return worker.Do()
}

func (Impl) Do() error {
	return nil
}
